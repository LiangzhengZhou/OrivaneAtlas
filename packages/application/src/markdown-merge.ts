interface EditRange {
  readonly start: number;
  readonly end: number;
  readonly lines: readonly string[];
}

function editRange(
  base: readonly string[],
  changed: readonly string[],
): EditRange {
  let start = 0,
    suffix = 0;
  while (
    start < base.length &&
    start < changed.length &&
    base[start] === changed[start]
  )
    start++;
  while (
    suffix < base.length - start &&
    suffix < changed.length - start &&
    base[base.length - suffix - 1] === changed[changed.length - suffix - 1]
  )
    suffix++;
  return {
    start,
    end: base.length - suffix,
    lines: changed.slice(start, changed.length - suffix),
  };
}

/** Linear, conservative three-way merge: ambiguous/overlapping ranges require review. */
export function mergeMarkdown(
  base: string,
  local: string,
  remote: string,
): { text: string; conflicts: number } {
  if (local === remote || remote === base) return { text: local, conflicts: 0 };
  if (local === base) return { text: remote, conflicts: 0 };
  const lines = base.split("\n");
  const edits = [
    editRange(lines, local.split("\n")),
    editRange(lines, remote.split("\n")),
  ].sort((a, b) => a.start - b.start);
  const first = edits[0]!,
    second = edits[1]!;
  if (first.end > second.start || first.start === second.start)
    return {
      text: `<<<<<<< Local\n${local}\n=======\n${remote}\n>>>>>>> Latest`,
      conflicts: 1,
    };
  const merged = [...lines];
  for (const edit of edits.reverse())
    merged.splice(edit.start, edit.end - edit.start, ...edit.lines);
  return { text: merged.join("\n"), conflicts: 0 };
}
