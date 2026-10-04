import { StreamLanguage } from "@codemirror/language";

/** Bounded, line-incremental editing syntax for large documents.
 * Reading/export continue to use the complete Markdown renderer. */
export const largeMarkdownLanguage = StreamLanguage.define({
  startState: () => ({ fence: "" }),
  token(stream, state) {
    if (stream.sol()) {
      const fence = stream.match(/^\s*(`{3,}|~{3,})/);
      if (fence && typeof fence !== "boolean") {
        const marker = fence[1]!;
        if (!state.fence) state.fence = marker;
        else if (
          marker[0] === state.fence[0] &&
          marker.length >= state.fence.length &&
          !stream.string.slice(stream.pos).trim()
        )
          state.fence = "";
        stream.skipToEnd();
        return "monospace";
      }
      if (state.fence) {
        stream.skipToEnd();
        return "monospace";
      }
      if (stream.match(/^#{1,6}\s/)) {
        stream.skipToEnd();
        return "heading";
      }
      if (stream.match(/^\s*>\s?/)) return "quote";
      if (stream.match(/^\s*(?:[-+*]|\d+[.)])\s/)) return "list";
    }
    if (stream.match(/^`[^`]*`/)) return "monospace";
    if (stream.match(/^(?:\*\*[^*]+\*\*|__[^_]+__)/)) return "strong";
    if (stream.match(/^(?:\*[^*]+\*|_[^_]+_)/)) return "emphasis";
    if (stream.match(/^!?\[[^\]]*\](?:\([^)]*\)|\[[^\]]*\])/)) return "link";
    if (stream.match(/^\[\[[^\]]*\]\]/)) return "link";
    stream.next();
    stream.eatWhile(/[^`*_\[!]/);
    return null;
  },
});
