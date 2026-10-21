/** Select canonical Markdown only; coordinates use CodeMirror UTF-16 offsets. */
export function markdownContextRange(
  body: string,
  range: { from: number; to: number },
): string {
  if (
    !Number.isSafeInteger(range.from) ||
    !Number.isSafeInteger(range.to) ||
    range.from < 0 ||
    range.to <= range.from ||
    range.to > body.length ||
    range.to - range.from > 12000
  )
    throw new Error("CONTEXT_CHANGED");
  return body.slice(range.from, range.to);
}
