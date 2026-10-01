import {
  autocompletion,
  type CompletionContext,
} from "@codemirror/autocomplete";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import { syntaxTree } from "@codemirror/language";
import {
  Compartment,
  EditorState,
  Facet,
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
import { useContext, useEffect, useLayoutEffect, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { useTranslation } from "react-i18next";
import { externalValue, pendingImage } from "./imageInsertion";
import { Markdown, PrivateImageContext } from "./Markdown";

const imageLoader = Facet.define<((path: string) => Promise<Blob>) | null>();

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
    readonly load: ((path: string) => Promise<Blob>) | null,
  ) {
    super();
  }
  eq(other: PreviewWidget) {
    return (
      other.text === this.text &&
      other.from === this.from &&
      other.load === this.load
    );
  }
  toDOM(view: EditorView) {
    const dom = document.createElement("div");
    dom.className = "md-live-widget";
    dom.addEventListener("mousedown", (event) => {
      if (event.target instanceof Element && event.target.closest("button"))
        return;
      event.preventDefault();
      view.dispatch({ selection: { anchor: this.from } });
      view.focus();
    });
    this.root = createRoot(dom);
    this.root.render(
      <PrivateImageContext.Provider value={this.load}>
        <Markdown text={this.text} />
      </PrivateImageContext.Provider>,
    );
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
        /^!\[[^\]\n]*\]\(\/api\/library\/asset\?id=[a-zA-Z0-9-]+\)$/m.test(
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
          widget: new PreviewWidget(
            text,
            node.from,
            state.facet(imageLoader)[0] ?? null,
          ),
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
    return tr.docChanged || tr.selection || tr.reconfigured
      ? blockPreviews(tr.state)
      : value;
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
  wikiPages = [],
}: {
  value: string;
  source: boolean;
  label: string;
  onChange: (text: string) => void;
  onSave: () => void;
  onComposition: (active: boolean) => void;
  editorRef: { current: EditorView | null };
  onImages?: (files: File[]) => void;
  wikiPages?: readonly {
    id: string;
    title: string;
    aliases?: readonly string[];
  }[];
}) {
  const parent = useRef<HTMLDivElement>(null);
  const { i18n } = useTranslation();
  const language = useRef(i18n.language);
  language.current = i18n.language;
  const load = useContext(PrivateImageContext);
  const loaderConfig = useRef(new Compartment());
  const initialLoader = useRef(load);
  const callbacks = useRef({ onChange, onSave, onComposition, onImages });
  callbacks.current = { onChange, onSave, onComposition, onImages };
  const mode = useRef(new Compartment());
  const initial = useRef({ value, source, label });
  const pages = useRef(wikiPages);
  pages.current = wikiPages;
  useEffect(() => {
    if (!parent.current) return;
    const view = new EditorView({
      parent: parent.current,
      state: EditorState.create({
        doc: initial.current.value,
        extensions: [
          markdown(),
          autocompletion({
            override: [
              (context: CompletionContext) => {
                const wiki = context.matchBefore(/\[\[[^\]\n]*/);
                if (wiki)
                  return {
                    from: wiki.from + 2,
                    options: pages.current.flatMap((page, index) =>
                      [page.title, ...(page.aliases ?? [])].map((title) => ({
                        label: title,
                        ...(title === page.title ? {} : { detail: page.title }),
                        type: "text",
                        boost: -index,
                        apply: `${title}]]`,
                      })),
                    ),
                  };
                const slash = context.matchBefore(/(?:^|\s)\/[\w]*/);
                if (!slash) return null;
                const from = slash.from + (slash.text.startsWith("/") ? 0 : 1);
                return {
                  from,
                  options: [
                    { label: "Heading", apply: "## " },
                    { label: "Task", apply: "- [ ] " },
                    { label: "Quote", apply: "> " },
                    { label: "Code", apply: "```\n\n```" },
                    {
                      label: "Table",
                      apply: "| Column | Column |\n| --- | --- |\n|  |  |",
                    },
                    { label: "Image", apply: "![Description](path)" },
                    { label: "Link document", apply: "[[" },
                    {
                      label: "Ask Atlas",
                      apply: () =>
                        window.dispatchEvent(new CustomEvent("atlas:open")),
                    },
                  ].map((option) => ({
                    ...option,
                    displayLabel: language.current.startsWith("zh")
                      ? ((
                          {
                            Heading: "标题",
                            Task: "任务",
                            Quote: "引用",
                            Code: "代码块",
                            Table: "表格",
                            Image: "图片",
                            "Link document": "链接文档",
                            "Ask Atlas": "询问 Atlas",
                          } as Record<string, string>
                        )[option.label] ?? option.label)
                      : option.label,
                  })),
                };
              },
            ],
          }),
          loaderConfig.current.of(imageLoader.of(initialLoader.current)),
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
      effects: loaderConfig.current.reconfigure(imageLoader.of(load)),
    });
  }, [load, editorRef]);
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
