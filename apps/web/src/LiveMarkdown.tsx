import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import { syntaxTree } from "@codemirror/language";
import {
  Compartment,
  EditorState,
  RangeSetBuilder,
  StateField,
} from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  keymap,
  ViewPlugin,
  type ViewUpdate,
  WidgetType,
} from "@codemirror/view";
import katex from "katex";
import { useEffect, useLayoutEffect, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { externalValue, pendingImage } from "./imageInsertion";
import { Markdown } from "./Markdown";

class MathWidget extends WidgetType {
  constructor(
    readonly formula: string,
    readonly from: number,
    readonly display: boolean,
  ) {
    super();
  }
  eq(other: MathWidget) {
    return (
      this.formula === other.formula &&
      this.from === other.from &&
      this.display === other.display
    );
  }
  toDOM(view: EditorView) {
    const dom = document.createElement("span");
    dom.className = "md-live-math";
    katex.render(this.formula, dom, {
      displayMode: this.display,
      throwOnError: false,
      trust: false,
      strict: "ignore",
      maxExpand: 500,
      maxSize: 20,
    });
    dom.addEventListener("mousedown", (event) => {
      event.preventDefault();
      view.dispatch({
        selection: { anchor: this.from + (this.display ? 2 : 1) },
      });
      view.focus();
    });
    return dom;
  }
  ignoreEvent() {
    return true;
  }
}

// Reuse the safe reading renderer; no raw HTML or remote image requests.
class PreviewWidget extends WidgetType {
  private root?: Root;
  private observer?: ResizeObserver;
  constructor(
    readonly text: string,
    readonly from: number,
  ) {
    super();
  }
  eq(other: PreviewWidget) {
    return other.text === this.text && other.from === this.from;
  }
  toDOM(view: EditorView) {
    const dom = document.createElement("div");
    dom.className = "md-live-widget";
    dom.addEventListener("mousedown", (event) => {
      event.preventDefault();
      view.dispatch({ selection: { anchor: this.from } });
      view.focus();
    });
    this.root = createRoot(dom);
    this.root.render(<Markdown text={this.text} />);
    this.observer = new ResizeObserver(() => view.requestMeasure());
    this.observer.observe(dom);
    return dom;
  }
  destroy() {
    this.observer?.disconnect();
    const root = this.root;
    queueMicrotask(() => root?.unmount());
  }
  ignoreEvent() {
    return true;
  }
}
function blockPreviews(state: EditorState): DecorationSet {
  const ranges: ReturnType<Decoration["range"]>[] = [];
  syntaxTree(state).iterate({
    enter(node) {
      if (node.name !== "Paragraph" && node.name !== "Table") return;
      const text = state.sliceDoc(node.from, node.to);
      if (node.name === "Paragraph") {
        const math =
          /(?<![\\$])\$\$([\s\S]+?)\$\$(?!\$)|(?<![\\$])\$(?![\s$])([^$\n]*?[^\s\\$])\$(?!\$)/g;
        for (const match of text.matchAll(math)) {
          const from = node.from + (match.index ?? 0);
          const to = from + match[0].length;
          let excluded = false;
          syntaxTree(state).iterate({
            from,
            to,
            enter(n) {
              if (/^(InlineCode|Link|Image|Autolink)$/.test(n.name))
                excluded = true;
            },
          });
          if (excluded) continue;
          const active = state.selection.ranges.some(
            (r) => r.from <= to && r.to >= from,
          );
          const widget = new MathWidget(
            match[1] ?? match[2] ?? "",
            from,
            match[1] !== undefined,
          );
          ranges.push(
            active
              ? Decoration.widget({ widget, side: 1 }).range(to)
              : Decoration.replace({ widget }).range(from, to),
          );
        }
      }
      const preview =
        node.name === "Table" ||
        /^!\[[^\]\n]*\]\(\/api\/library\/asset\?id=[a-zA-Z0-9-]+\)$/.test(
          text.trim(),
        ) ||
        /^\|?.+\|.+\n\|?\s*:?-{3,}/.test(text);
      if (
        !preview ||
        state.selection.ranges.some(
          (r) => r.from <= node.to && r.to >= node.from,
        )
      )
        return;
      ranges.push(
        Decoration.replace({
          widget: new PreviewWidget(text, node.from),
          block: true,
        }).range(node.from, node.to),
      );
      return false;
    },
  });
  return Decoration.set(ranges, true);
}
// Block replacements must be direct state decorations, not viewport plugins.
const blockPreview = StateField.define<DecorationSet>({
  create: blockPreviews,
  update(value, tr) {
    return tr.docChanged || tr.selection ? blockPreviews(tr.state) : value;
  },
  provide: (field) => EditorView.decorations.from(field),
});
// Decorations never alter Markdown or undo history. Reveal syntax on selected lines.
function decorate(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const ranges: { from: number; to: number; decoration: Decoration }[] = [];
  syntaxTree(view.state).iterate({
    enter(node) {
      const name = node.name;
      if (
        /^(ATXHeading[1-6]|StrongEmphasis|Emphasis|InlineCode|Link)$/.test(name)
      ) {
        ranges.push({
          from: node.from,
          to: node.to,
          decoration: Decoration.mark({
            class: "md-live-" + name.toLowerCase(),
          }),
        });
      }
      if (!/^(HeaderMark|EmphasisMark|CodeMark)$/.test(name)) return;
      const line = view.state.doc.lineAt(node.from);
      if (
        view.state.selection.ranges.some(
          (r) => r.from <= line.to && r.to >= line.from,
        )
      )
        return;
      ranges.push({
        from: node.from,
        to: node.to,
        decoration: Decoration.replace({}),
      });
    },
  });
  ranges.sort(
    (a, b) =>
      a.from - b.from || a.decoration.startSide - b.decoration.startSide,
  );
  for (const r of ranges) builder.add(r.from, r.to, r.decoration);
  return builder.finish();
}
const livePreview = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = decorate(view);
    }
    update(update: ViewUpdate) {
      if (update.docChanged || update.selectionSet || update.viewportChanged)
        this.decorations = decorate(update.view);
    }
  },
  { decorations: (v) => v.decorations },
);
export function LiveMarkdown({
  value,
  source,
  label,
  onChange,
  onSave,
  onComposition,
  editorRef,
  onImages,
}: {
  value: string;
  source: boolean;
  label: string;
  onChange: (text: string) => void;
  onSave: () => void;
  onComposition: (active: boolean) => void;
  editorRef: { current: EditorView | null };
  onImages?: (files: File[]) => void;
}) {
  const parent = useRef<HTMLDivElement>(null);
  const callbacks = useRef({ onChange, onSave, onComposition, onImages });
  callbacks.current = { onChange, onSave, onComposition, onImages };
  const mode = useRef(new Compartment());
  const initial = useRef({ value, source, label });
  useEffect(() => {
    if (!parent.current) return;
    const view = new EditorView({
      parent: parent.current,
      state: EditorState.create({
        doc: initial.current.value,
        extensions: [
          markdown(),
          history(),
          pendingImage,
          EditorView.lineWrapping,
          EditorView.contentAttributes.of({
            "aria-label": initial.current.label,
            role: "textbox",
            "aria-multiline": "true",
          }),
          EditorState.transactionFilter.of((tr) =>
            tr.newDoc.length > 200000 ? [] : tr,
          ),
          keymap.of([
            {
              key: "Mod-s",
              run: () => {
                callbacks.current.onSave();
                return true;
              },
            },
            ...defaultKeymap,
            ...historyKeymap,
          ]),
          EditorView.domEventHandlers({
            paste: (event) => {
              const files = Array.from(event.clipboardData?.files ?? []).filter(
                (file) => file.type.startsWith("image/"),
              );
              if (!files.length || !callbacks.current.onImages) return false;
              event.preventDefault();
              callbacks.current.onImages(files);
              return true;
            },
            compositionstart: () => {
              callbacks.current.onComposition(true);
            },
            compositionend: () => {
              callbacks.current.onComposition(false);
            },
          }),
          EditorView.updateListener.of((update) => {
            if (
              update.docChanged &&
              !update.transactions.every((tr) => tr.annotation(externalValue))
            )
              callbacks.current.onChange(update.state.doc.toString());
          }),
          mode.current.of(
            initial.current.source ? [] : [livePreview, blockPreview],
          ),
        ],
      }),
    });
    editorRef.current = view;
    return () => {
      editorRef.current = null;
      view.destroy();
    };
  }, [editorRef]);
  useEffect(() => {
    editorRef.current?.dispatch({
      effects: mode.current.reconfigure(
        source ? [] : [livePreview, blockPreview],
      ),
    });
  }, [source, editorRef]);
  // Apply controlled replacements before another input event. A passive effect
  // can replay stale text over fast Android typing and invalidate upload anchors.
  useLayoutEffect(() => {
    const view = editorRef.current;
    if (view && view.state.doc.toString() !== value.replace(/\r\n?/g, "\n"))
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: value },
        annotations: externalValue.of(true),
      });
  }, [value, editorRef]);
  return <div className="live-markdown" ref={parent} />;
}
