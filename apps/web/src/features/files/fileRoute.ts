import type { LibraryFile } from "@arclattice/domain";

const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function fileHash(id: string): string {
  if (!uuid.test(id)) throw new Error("INVALID_FILE_LINK");
  return `#library?file=${encodeURIComponent(id)}`;
}
export function parseFileHash(hash: string): string | null {
  if (!hash.startsWith("#library?")) return null;
  const query = new URLSearchParams(hash.slice("#library?".length));
  const ids = query.getAll("file");
  return ids.length === 1 && uuid.test(ids[0]!) ? ids[0]! : null;
}
export function fileMarkdownLink(
  file: Pick<LibraryFile, "id" | "name">,
): string {
  const name = file.name.replace(/[\r\n]/g, " ").replace(/([\\[\]])/g, "\\$1");
  return `[${name}](${fileHash(file.id)})`;
}
