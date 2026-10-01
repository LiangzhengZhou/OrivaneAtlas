export function mergeMarkdown(
  base: string,
  local: string,
  remote: string,
): { text: string; conflicts: number } {
  if (local === remote || remote === base) return { text: local, conflicts: 0 };
  if (local === base) return { text: remote, conflicts: 0 };
  const baseLines = base.split("\n");
  const localLines = local.split("\n");
  const remoteLines = remote.split("\n");
  let conflicts = 0;
  const text = Array.from(
    {
      length: Math.max(baseLines.length, localLines.length, remoteLines.length),
    },
    (_, index) => {
      if (
        localLines[index] === remoteLines[index] ||
        remoteLines[index] === baseLines[index]
      )
        return localLines[index];
      if (localLines[index] === baseLines[index]) return remoteLines[index];
      conflicts++;
      return `<<<<<<< Local\n${localLines[index] ?? ""}\n=======\n${remoteLines[index] ?? ""}\n>>>>>>> Latest`;
    },
  )
    .filter((line) => line !== undefined)
    .join("\n");
  return { text, conflicts };
}
