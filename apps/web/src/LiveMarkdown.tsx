import {
  autocompletion,
  type Completion,
  type CompletionContext,
} from "@codemirror/autocomplete";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import {
  defaultHighlightStyle,
  language,
  syntaxHighlighting,
  syntaxTree,
} from "@codemirror/language";
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
import {
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createRoot, type Root } from "react-dom/client";
import { useTranslation } from "react-i18next";
import { largeMarkdownLanguage } from "./features/documents/large-markdown-language";
import { MarkdownCommandIcon } from "./features/documents/MarkdownCommandIcon";
import {
  MarkdownCommandRegistry,
  runMarkdownCommand,
} from "./features/documents/markdown-commands";
import { externalValue, pendingImage } from "./imageInsertion";
import { Markdown, PrivateImageContext } from "./Markdown";
import "./features/documents/markdown-commands.css";

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
  if (
    state.facet(language) === largeMarkdownLanguage ||
    state.doc.length > 50000
  )
    return Decoration.none;
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
        /^!\[[^\]\n]*\]\(\/api\/(?:library\/asset|v1\/files\/bytes)\?id=[a-zA-Z0-9-]+\)$/m.test(
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
// Keep inline and block formula source legible while editing: delimiters and
// formula body get independent semantic colors, matching the rendered math.
function mathMarks(
  state: EditorState,
  from: number,
  to: number,
): { from: number; to: number; decoration: Decoration }[] {
  if (state.doc.length > 50000) return [];
  const text = state.sliceDoc(from, to);
  const pattern =
    /(?<![\\$])\$\$([\s\S]+?)\$\$(?!\$)|(?<![\\$])\$(?![\s$])([^$\n]*?[^\s\\$])\$(?!\$)/g;
  const ranges: { from: number; to: number; decoration: Decoration }[] = [];
  for (const match of text.matchAll(pattern)) {
    const start = from + (match.index ?? 0);
    const end = start + match[0].length;
    const block = match[1] !== undefined;
    const delimiter = block ? 2 : 1;
    let excluded = false;
    syntaxTree(state).iterate({
      from: start,
      to: end,
      enter(node) {
        if (
          /^(InlineCode|FencedCode|CodeBlock|Link|Image|Autolink)$/.test(
            node.name,
          )
        )
          excluded = true;
      },
    });
    if (excluded) continue;
    const contentFrom = start + delimiter,
      contentTo = end - delimiter;
    ranges.push({
      from: start,
      to: contentFrom,
      decoration: Decoration.mark({ class: "md-math-delimiter" }),
    });
    ranges.push({
      from: contentTo,
      to: end,
      decoration: Decoration.mark({ class: "md-math-delimiter" }),
    });
    if (contentTo > contentFrom)
      ranges.push({
        from: contentFrom,
        to: contentTo,
        decoration: Decoration.mark({ class: "md-math-content" }),
      });
  }
  return ranges;
}
function mathDecorationSet(view: EditorView): DecorationSet {
  const ranges = mathMarks(
    view.state,
    view.viewport.from,
    view.viewport.to,
  ).sort(
    (a, b) =>
      a.from - b.from || a.decoration.startSide - b.decoration.startSide,
  );
  const builder = new RangeSetBuilder<Decoration>();
  for (const range of ranges)
    builder.add(range.from, range.to, range.decoration);
  return builder.finish();
}
const mathHighlight = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = mathDecorationSet(view);
    }
    update(update: ViewUpdate) {
      if (update.docChanged || update.viewportChanged)
        this.decorations = mathDecorationSet(update.view);
    }
  },
  { decorations: (value) => value.decorations },
);

// Decorations never alter Markdown or undo history. Reveal syntax on selected lines.
function decorate(view: EditorView): DecorationSet {
  // The incremental language supplies its own highlighting and has no rich
  // Markdown AST nodes. Walking it on every selection/input cannot decorate.
  if (view.state.facet(language) === largeMarkdownLanguage)
    return Decoration.none;
  const builder = new RangeSetBuilder<Decoration>();
  const ranges: { from: number; to: number; decoration: Decoration }[] = [];
  syntaxTree(view.state).iterate({
    from: view.viewport.from,
    to: view.viewport.to,
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
  onPendingChange,
  onAtlas,
  onAttachFile,
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
  onPendingChange?: (pending: boolean) => void;
  onAtlas?: () => void;
  onAttachFile?: () => void;
  wikiPages?: readonly {
    id: string;
    title: string;
    aliases?: readonly string[];
  }[];
}) {
  const parent = useRef<HTMLDivElement>(null);
  const surface = useRef<HTMLDivElement>(null);
  const contextRef = useRef<HTMLDivElement>(null);
  const contextSelection = useRef<{ anchor: number; head: number } | null>(
    null,
  );
  const [contextOpen, setContextOpen] = useState(false);
  const [contextPoint, setContextPoint] = useState({ left: 0, top: 0 });
  const { i18n } = useTranslation();
  const language = useRef(i18n.language);
  language.current = i18n.language;
  const load = useContext(PrivateImageContext);
  const loaderConfig = useRef(new Compartment());
  const initialLoader = useRef(load);
  const callbacks = useRef({
    onChange,
    onSave,
    onComposition,
    onImages,
    onPendingChange,
    onAtlas,
    onAttachFile,
  });
  callbacks.current = {
    onChange,
    onSave,
    onComposition,
    onImages,
    onPendingChange,
    onAtlas,
    onAttachFile,
  };
  const mode = useRef(new Compartment());
  const syntaxMode = useRef(new Compartment());
  const largeSyntax = useRef(value.length >= 50000);
  const initial = useRef({ value, source, label });
  const published = useRef(value.replace(/\r\n?/g, "\n"));
  const pages = useRef(wikiPages);
  pages.current = wikiPages;
  useEffect(() => {
    if (!parent.current) return;
    let syncTimer: ReturnType<typeof setTimeout> | undefined;
    let changed = false;
    const flush = () => {
      clearTimeout(syncTimer);
      if (!changed) return;
      changed = false;
      const text = view.state.doc.toString();
      published.current = text;
      callbacks.current.onChange(text);
      callbacks.current.onPendingChange?.(false);
    };
    const view = new EditorView({
      parent: parent.current,
      state: EditorState.create({
        doc: initial.current.value,
        extensions: [
          syntaxMode.current.of(
            largeSyntax.current
              ? [
                  largeMarkdownLanguage,
                  syntaxHighlighting(defaultHighlightStyle),
                ]
              : markdown(),
          ),
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
                  options: MarkdownCommandRegistry.map((command) => ({
                    label: command.en,
                    displayLabel: language.current.startsWith("zh")
                      ? command.zh
                      : command.en,
                    apply: (
                      view: EditorView,
                      _completion: Completion,
                      from: number,
                      to: number,
                    ) => {
                      runMarkdownCommand(view, command.id, {
                        range: { from, to },
                        askAtlas: callbacks.current.onAtlas,
                        attachFile: callbacks.current.onAttachFile,
                      });
                    },
                  })),
                };
              },
            ],
          }),
          loaderConfig.current.of(imageLoader.of(initialLoader.current)),
          history(),
          pendingImage,
          mathHighlight,
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
            ...MarkdownCommandRegistry.flatMap((command) =>
              "key" in command
                ? [
                    {
                      key: command.key,
                      run: (view: EditorView) =>
                        runMarkdownCommand(view, command.id, {
                          askAtlas: callbacks.current.onAtlas,
                          attachFile: callbacks.current.onAttachFile,
                        }),
                    },
                  ]
                : [],
            ),
            {
              key: "Mod-s",
              run: () => {
                flush();
                callbacks.current.onSave();
                return true;
              },
            },
            ...defaultKeymap,
            ...historyKeymap,
          ]),
          EditorView.domEventHandlers({
            mousedown: (event, view) => {
              if (event.button !== 2) return false;
              const selection = view.state.selection.main;
              contextSelection.current = {
                anchor: selection.anchor,
                head: selection.head,
              };
              return false;
            },
            blur: () => {
              flush();
            },
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
            ) {
              if (!changed) callbacks.current.onPendingChange?.(true);
              changed = true;
              clearTimeout(syncTimer);
              // Keep the CodeMirror document authoritative during a typing
              // burst. Save, blur and unmount still flush synchronously.
              syncTimer = setTimeout(flush, 250);
            }
          }),
          mode.current.of(
            initial.current.source ? [] : [livePreview, blockPreview],
          ),
        ],
      }),
    });
    editorRef.current = view;
    return () => {
      flush();
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
    const normalized = value.replace(/\r\n?/g, "\n");
    if (view && published.current !== normalized) {
      published.current = normalized;
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: value },
        annotations: externalValue.of(true),
      });
    }
    if (view) {
      const large =
        view.state.doc.length >= (largeSyntax.current ? 40000 : 50000);
      if (large !== largeSyntax.current) {
        largeSyntax.current = large;
        view.dispatch({
          effects: syntaxMode.current.reconfigure(
            large
              ? [
                  largeMarkdownLanguage,
                  syntaxHighlighting(defaultHighlightStyle),
                ]
              : markdown(),
          ),
        });
      }
    }
  }, [value, editorRef]);
  const zh = i18n.language.startsWith("zh");
  const visibleCommands = MarkdownCommandRegistry.filter(
    (command) => command.id !== "file" || onAttachFile,
  );
  const commandById = (id: string) =>
    visibleCommands.find((command) => command.id === id);
  function restoreContextSelection(view: EditorView) {
    if (contextSelection.current)
      view.dispatch({ selection: contextSelection.current });
  }
  function invoke(command: (typeof MarkdownCommandRegistry)[number]) {
    const view = editorRef.current;
    if (view) {
      restoreContextSelection(view);
      runMarkdownCommand(view, command.id, {
        askAtlas: onAtlas,
        attachFile: onAttachFile,
      });
    }
    closeContext();
  }
  function closeContext() {
    setContextOpen(false);
    editorRef.current?.focus();
  }
  async function copySelection(cut: boolean) {
    const view = editorRef.current;
    if (!view) return;
    restoreContextSelection(view);
    const { from, to } = view.state.selection.main;
    const text = view.state.sliceDoc(from, to);
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      view.focus();
      document.execCommand("copy");
    }
    if (cut)
      view.dispatch({
        changes: { from, to, insert: "" },
        selection: { anchor: from },
        userEvent: "delete.cut",
      });
    closeContext();
  }
  async function pasteClipboard() {
    const view = editorRef.current;
    if (!view) return;
    restoreContextSelection(view);
    try {
      const text = await navigator.clipboard.readText();
      if (!text) return;
      const { from, to } = view.state.selection.main;
      view.dispatch({
        changes: { from, to, insert: text },
        selection: { anchor: from + text.length },
        userEvent: "input.paste",
      });
    } catch {
      // Clipboard read can be denied by the host; leave the document unchanged.
    }
    closeContext();
  }
  function selectAll() {
    const view = editorRef.current;
    if (!view) return;
    view.dispatch({
      selection: { anchor: 0, head: view.state.doc.length },
    });
    closeContext();
  }
  function menuItem(
    label: string,
    action: () => void,
    options: {
      command?: string | undefined;
      shortcut?: string | undefined;
    } = {},
  ) {
    const command = options.command ? commandById(options.command) : undefined;
    return (
      <button
        key={label + (options.command ?? "")}
        type="button"
        role="menuitem"
        className="markdown-context-item"
        onClick={action}
      >
        {command && <MarkdownCommandIcon command={command.id} />}
        <span>{label}</span>
        {options.shortcut && <kbd>{options.shortcut}</kbd>}
      </button>
    );
  }
  function commandItem(id: string) {
    const command = commandById(id);
    if (!command) return null;
    return menuItem(zh ? command.zh : command.en, () => invoke(command), {
      command: command.id,
      shortcut:
        "key" in command ? command.key.replace("Mod", "Ctrl/⌘") : undefined,
    });
  }
  useEffect(() => {
    if (!contextOpen) return;
    const close = (event: Event) => {
      if (
        event.target instanceof Node &&
        contextRef.current?.contains(event.target)
      )
        return;
      setContextOpen(false);
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") setContextOpen(false);
    };
    window.addEventListener("pointerdown", close, true);
    window.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("pointerdown", close, true);
      window.removeEventListener("keydown", key);
    };
  }, [contextOpen]);
  useEffect(() => {
    const capture = (event: PointerEvent) => {
      if (event.button !== 2) return;
      const view = editorRef.current;
      if (!view) return;
      const selection = view.state.selection.main;
      contextSelection.current = {
        anchor: selection.anchor,
        head: selection.head,
      };
    };
    window.addEventListener("pointerdown", capture, true);
    return () => window.removeEventListener("pointerdown", capture, true);
  }, []);
  return (
    <div className="markdown-editor-surface" ref={surface}>
      <div
        className={`live-markdown${source ? " markdown-source" : ""}`}
        ref={parent}
        onContextMenu={(event) => {
          event.preventDefault();
          const view = editorRef.current;
          if (view && contextSelection.current)
            view.dispatch({ selection: contextSelection.current });
          setContextPoint({
            left: Math.max(8, Math.min(window.innerWidth - 248, event.clientX)),
            top: Math.max(8, Math.min(window.innerHeight - 420, event.clientY)),
          });
          setContextOpen(true);
        }}
        onKeyDown={(event) => {
          if (
            event.key === "ContextMenu" ||
            (event.shiftKey && event.key === "F10")
          ) {
            event.preventDefault();
            setContextPoint({
              left: Math.max(8, window.innerWidth / 2 - 120),
              top: Math.max(8, window.innerHeight / 2 - 180),
            });
            setContextOpen(true);
          }
        }}
      />
      {contextOpen && (
        <div
          ref={contextRef}
          className="markdown-context-menu glass-surface"
          role="menu"
          aria-label={zh ? "Markdown 命令" : "Markdown commands"}
          style={{ left: contextPoint.left, top: contextPoint.top }}
          onContextMenu={(event) => event.preventDefault()}
        >
          {menuItem(zh ? "剪切" : "Cut", () => void copySelection(true))}
          {menuItem(zh ? "复制" : "Copy", () => void copySelection(false))}
          {menuItem(zh ? "粘贴" : "Paste", () => void pasteClipboard())}
          {menuItem(zh ? "全选" : "Select all", selectAll)}
          <div className="markdown-context-separator" />
          {(
            ["bold", "italic", "strike", "inline-code", "formula"] as const
          ).map(commandItem)}
          <div className="markdown-context-separator" />
          {(["heading", "bullet", "numbered", "task", "quote"] as const).map(
            commandItem,
          )}
          <div className="markdown-context-separator" />
          {(["link", "wiki", "table", "divider", "code", "image"] as const).map(
            commandItem,
          )}
          {onAttachFile && (
            <>
              <div className="markdown-context-separator" />
              {commandItem("file")}
            </>
          )}
          {onAtlas && (
            <>
              <div className="markdown-context-separator" />
              {commandItem("atlas")}
            </>
          )}
        </div>
      )}
    </div>
  );
}
