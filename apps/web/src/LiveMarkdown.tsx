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
import { Button } from "./components/ui/Button";
import { Menu, Select } from "./components/ui/Surfaces";
import { DocumentPopover } from "./features/documents/DocumentPopover";
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
  const [toolbarPreference, setToolbarPreference] = useState<
    "AUTO" | "PINNED" | "HIDDEN"
  >(() => {
    try {
      const value = localStorage.getItem("orivane.atlas.markdown-toolbar");
      return value === "PINNED" || value === "HIDDEN" ? value : "AUTO";
    } catch {
      return "AUTO";
    }
  });
  const [hasSelection, setHasSelection] = useState(false),
    [focused, setFocused] = useState(false),
    [selectionPoint, setSelectionPoint] = useState<{
      left: number;
      top: number;
    } | null>(null),
    [contextOpen, setContextOpen] = useState(false);
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
    const placeSelectionToolbar = (target: EditorView) => {
      const selection = target.state.selection.main;
      if (selection.empty) {
        setSelectionPoint(null);
        return;
      }
      const coords = target.coordsAtPos(selection.from);
      if (!coords) {
        setSelectionPoint(null);
        return;
      }
      setSelectionPoint({
        left: Math.max(8, Math.min(window.innerWidth - 260, coords.left)),
        top: Math.max(8, coords.top - 52),
      });
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
            focus: () => {
              setFocused(true);
              placeSelectionToolbar(view);
            },
            blur: (event) => {
              setFocused(
                !!event.relatedTarget &&
                  surface.current?.contains(event.relatedTarget as Node) ===
                    true,
              );
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
            if (update.selectionSet) {
              setHasSelection(!update.state.selection.main.empty);
              placeSelectionToolbar(update.view);
            }
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
    const repositionSelectionToolbar = () => placeSelectionToolbar(view);
    window.addEventListener("scroll", repositionSelectionToolbar, true);
    window.addEventListener("resize", repositionSelectionToolbar);
    return () => {
      flush();
      window.removeEventListener("scroll", repositionSelectionToolbar, true);
      window.removeEventListener("resize", repositionSelectionToolbar);
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
  function invoke(command: (typeof MarkdownCommandRegistry)[number]) {
    const view = editorRef.current;
    if (view)
      runMarkdownCommand(view, command.id, {
        askAtlas: onAtlas,
        attachFile: onAttachFile,
      });
    setContextOpen(false);
  }
  function controls(selection: boolean, floating = false) {
    return (
      <div
        role="toolbar"
        aria-label={
          selection
            ? zh
              ? "选区工具栏"
              : "Selection toolbar"
            : zh
              ? "Markdown 工具栏"
              : "Markdown toolbar"
        }
        className={`markdown-command-toolbar${floating ? " is-floating glass-surface" : ""}`}
        style={
          floating && selectionPoint
            ? { left: selectionPoint.left, top: selectionPoint.top }
            : undefined
        }
      >
        {visibleCommands
          .filter((command) =>
            ["bold", "italic", "link", "atlas"].includes(command.id),
          )
          .map((command) => (
            <Button
              key={command.id}
              variant="ghost"
              className="markdown-format-button"
              aria-label={zh ? command.zh : command.en}
              title={
                (zh ? command.zh : command.en) +
                ("key" in command
                  ? ` (${command.key.replace("Mod", "Ctrl/⌘")})`
                  : "")
              }
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => invoke(command)}
            >
              <MarkdownCommandIcon command={command.id} />
            </Button>
          ))}
        <DocumentPopover
          className="markdown-command-menu"
          label={zh ? "更多格式" : "More formatting"}
        >
          {visibleCommands.map((command) => (
            <Button
              key={command.id}
              variant="ghost"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => invoke(command)}
            >
              <MarkdownCommandIcon command={command.id} />
              {zh ? command.zh : command.en}
            </Button>
          ))}
        </DocumentPopover>
      </div>
    );
  }
  return (
    <div className="markdown-editor-surface" ref={surface}>
      <div className="markdown-toolbar-preference">
        <Select
          label={zh ? "编辑器工具栏" : "Editor toolbar"}
          value={toolbarPreference}
          onChange={(event) => {
            const next =
              event.target.value === "PINNED"
                ? "PINNED"
                : event.target.value === "HIDDEN"
                  ? "HIDDEN"
                  : "AUTO";
            setToolbarPreference(next);
            try {
              localStorage.setItem("orivane.atlas.markdown-toolbar", next);
            } catch {
              /* Device UI preference only. */
            }
          }}
        >
          <option value="AUTO">
            {zh ? "自动工具栏" : "Automatic toolbar"}
          </option>
          <option value="PINNED">
            {zh ? "始终显示工具栏" : "Always show toolbar"}
          </option>
          <option value="HIDDEN">{zh ? "隐藏工具栏" : "Hide toolbar"}</option>
        </Select>
      </div>
      {toolbarPreference === "PINNED" && controls(hasSelection)}
      {toolbarPreference === "AUTO" &&
        focused &&
        hasSelection &&
        controls(true, true)}
      <div
        className={`live-markdown${source ? " markdown-source" : ""}`}
        ref={parent}
        onContextMenu={(event) => {
          event.preventDefault();
          setContextOpen(true);
        }}
        onKeyDown={(event) => {
          if (
            event.key === "ContextMenu" ||
            (event.shiftKey && event.key === "F10")
          ) {
            event.preventDefault();
            setContextOpen(true);
          }
        }}
      />
      {contextOpen && (
        <Menu
          anchorRef={parent}
          label={zh ? "Markdown 命令" : "Markdown commands"}
          onDismiss={() => setContextOpen(false)}
        >
          {visibleCommands.map((command) => (
            <Button
              key={command.id}
              role="menuitem"
              variant="ghost"
              onClick={() => invoke(command)}
            >
              <MarkdownCommandIcon command={command.id} />
              {zh ? command.zh : command.en}
            </Button>
          ))}
        </Menu>
      )}
    </div>
  );
}
