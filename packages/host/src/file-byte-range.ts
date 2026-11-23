/** A single range over a verified representation. Unsupported or malformed range fields fall back to a full response. */
export function fileByteRange(range: string | undefined, size: number) {
  if (!range) return null;
  const match = /^bytes=(\d*)-(\d*)$/i.exec(range.trim());
  if (!match || (!match[1] && !match[2])) return null;
  // Any integer beyond the safe range already exceeds the maximum Blob size.
  const limit = (value: string) =>
    Math.min(Number(value), Number.MAX_SAFE_INTEGER);
  const first = match[1] ? limit(match[1]) : null;
  const last = match[2] ? limit(match[2]) : null;
  if (first !== null && last !== null && last < first) return null;
  if (
    !size ||
    (first !== null && first >= size) ||
    (first === null && last === 0)
  )
    return "unsatisfiable";
  return {
    start: first ?? Math.max(0, size - last!),
    end: first === null || last === null ? size - 1 : Math.min(last, size - 1),
  };
}
