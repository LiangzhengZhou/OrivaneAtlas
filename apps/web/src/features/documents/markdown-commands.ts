import type { EditorState, TransactionSpec } from "@codemirror/state";

export const MarkdownCommandRegistry = [
  { id: "heading", en: "Heading", zh: "标题" },
  { id: "bold", en: "Bold", zh: "粗体", key: "Mod-b" },
  { id: "italic", en: "Italic", zh: "斜体", key: "Mod-i" },
  { id: "strike", en: "Strikethrough", zh: "删除线" },
  { id: "inline-code", en: "Inline code", zh: "行内代码" },
  { id: "code", en: "Code block", zh: "代码块" },
  { id: "link", en: "Link", zh: "链接", key: "Mod-k" },
  { id: "wiki", en: "Wiki link", zh: "文档链接" },
  { id: "image", en: "Image", zh: "图片" },
  { id: "formula", en: "Formula", zh: "公式" },
  { id: "table", en: "Table", zh: "表格" },
  { id: "bullet", en: "Bullet list", zh: "无序列表" },
  { id: "numbered", en: "Numbered list", zh: "有序列表" },
  { id: "task", en: "Task list", zh: "任务列表" },
  { id: "quote", en: "Quote", zh: "引用" },
  { id: "divider", en: "Divider", zh: "分隔线" },
  { id: "file", en: "Attach file", zh: "附加文件" },
  { id: "atlas", en: "Ask Atlas", zh: "询问 Atlas", key: "Mod-j" },
] as const;
export type MarkdownCommandId = (typeof MarkdownCommandRegistry)[number]["id"];
export interface MarkdownCommandView {
  readonly state: EditorState;
  dispatch(spec: TransactionSpec): void;
  focus(): void;
}
export interface MarkdownCommandOptions {
  range?: { from: number; to: number };
  askAtlas?: (() => void) | undefined;
  attachFile?: (() => void) | undefined;
}

/** Every entry point shares this single CodeMirror transaction implementation.
 * Only Markdown is produced; no visual font/color state or business mutation. */
export function runMarkdownCommand(
  view: MarkdownCommandView,
  id: MarkdownCommandId,
  options: MarkdownCommandOptions = {},
) {
  const doc = view.state.doc;
  const range = options.range ?? view.state.selection.main;
  let from = range.from,
    to = range.to;
  if (from < 0 || to < from || to > doc.length) return false;
  if (id === "atlas" || id === "file") {
    const invoke = id === "atlas" ? options.askAtlas : options.attachFile;
    if (!invoke) return false;
    if (options.range)
      view.dispatch({
        changes: { from, to, insert: "" },
        selection: { anchor: from },
        userEvent: "input.markdown",
      });
    invoke();
    return true;
  }
  const selected = options.range ? "" : doc.sliceString(from, to);
  let insert = selected;
  let anchor = from,
    head = to;
  const markers: Partial<Record<MarkdownCommandId, string>> = {
    bold: "**",
    italic: "*",
    strike: "~~",
    "inline-code": "`",
    formula: "$",
  };
  const marker = markers[id];
  if (marker) {
    if (
      !options.range &&
      doc.sliceString(Math.max(0, from - marker.length), from) === marker &&
      doc.sliceString(to, to + marker.length) === marker
    ) {
      from -= marker.length;
      to += marker.length;
      insert = selected;
      anchor = from;
      head = from + selected.length;
    } else {
      insert = marker + selected + marker;
      anchor = from + marker.length;
      head = anchor + selected.length;
    }
  } else if (["heading", "bullet", "numbered", "task", "quote"].includes(id)) {
    const prefix = {
      heading: "## ",
      bullet: "- ",
      numbered: "1. ",
      task: "- [ ] ",
      quote: "> ",
    }[id as "heading" | "bullet" | "numbered" | "task" | "quote"];
    if (!options.range) {
      from = doc.lineAt(from).from;
      to = doc.lineAt(to > range.from ? to - 1 : to).to;
    }
    const lines = options.range ? [""] : doc.sliceString(from, to).split("\n");
    const remove =
      !options.range && lines.every((line) => line.startsWith(prefix));
    insert = lines
      .map((line) => (remove ? line.slice(prefix.length) : prefix + line))
      .join("\n");
    anchor = from;
    head = from + insert.length;
  } else {
    switch (id) {
      case "code":
        insert = "```\n" + selected + "\n```";
        anchor = from + 4;
        head = anchor + selected.length;
        break;
      case "link":
        insert = "[" + selected + "](url)";
        anchor = from + selected.length + 3;
        head = anchor + 3;
        break;
      case "wiki":
        insert = "[[" + selected + "]]";
        anchor = from + 2;
        head = anchor + selected.length;
        break;
      case "image":
        insert = "![" + selected + "](path)";
        anchor = from + selected.length + 4;
        head = anchor + 4;
        break;
      case "table":
        insert = "| Column | Column |\n| --- | --- |\n|  |  |";
        anchor = from + insert.length;
        head = anchor;
        break;
      case "divider":
        insert = "\n---\n";
        anchor = from + insert.length;
        head = anchor;
        break;
    }
  }
  if (doc.length - (to - from) + insert.length > 200000) return false;
  view.dispatch({
    changes: { from, to, insert },
    selection: { anchor, head },
    userEvent: "input.markdown",
  });
  view.focus();
  return true;
}
