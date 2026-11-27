import { zipSync } from "fflate";

function safeName(value: string) {
  return (value.trim().replace(/[^\p{L}\p{N}._-]+/gu, "-") || "document").slice(
    0,
    80,
  );
}
function downloadBlob(name: string, data: BlobPart, type: string) {
  const url = URL.createObjectURL(new Blob([data], { type })),
    link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function exportPdf() {
  window.print();
}
export async function exportHtml(
  title: string,
  body: string,
  loadImage: (path: string) => Promise<Blob>,
) {
  let html = body
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/^### (.+)$/gm, "<h3>$1</h3>")
    .replace(/^## (.+)$/gm, "<h2>$1</h2>")
    .replace(/^# (.+)$/gm, "<h1>$1</h1>")
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\n/g, "<br>\n");
  const imagePaths = [
    ...new Set(
      [
        ...body.matchAll(
          /!\[[^\]]*\]\((\/api\/(?:library\/asset|v1\/files\/bytes)\?id=[A-Za-z0-9-]+)\)/g,
        ),
      ]
        .map((match) => match[1])
        .filter((path): path is string => !!path),
    ),
  ];
  for (const path of imagePaths) {
    const blob = await loadImage(path);
    const data = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
    html = html.split(path).join(data);
  }
  html = html.replace(
    /!\[([^\]]*)\]\((data:[^)]+)\)/g,
    '<img alt="$1" src="$2">',
  );
  downloadBlob(
    `${safeName(title)}.html`,
    `<!doctype html><meta charset="utf-8"><title>${title}</title><style>body{max-width:860px;margin:40px auto;font:16px system-ui;line-height:1.6}img{max-width:100%}pre{background:#eee;padding:12px}</style><h1>${title}</h1><main>${html}</main>`,
    "text/html;charset=utf-8",
  );
}
export async function exportMarkdownZip(
  title: string,
  body: string,
  loadImage: (path: string) => Promise<Blob>,
) {
  const imagePaths = [
    ...new Set(
      [
        ...body.matchAll(
          /!\[[^\]]*\]\((\/api\/(?:library\/asset|v1\/files\/bytes)\?id=[A-Za-z0-9-]+)\)/g,
        ),
      ]
        .map((match) => match[1])
        .filter((path): path is string => !!path),
    ),
  ];
  const files: Record<string, Uint8Array> = {};
  let markdown = body;
  for (let index = 0; index < imagePaths.length; index++) {
    const path = imagePaths[index];
    if (!path) continue;
    const blob = await loadImage(path);
    const extension =
      blob.type.split("/")[1] === "jpeg"
        ? "jpg"
        : (blob.type.split("/")[1] ?? "bin");
    const name = `assets/image-${String(index + 1).padStart(3, "0")}.${extension}`;
    files[name] = new Uint8Array(await blob.arrayBuffer());
    markdown = markdown.split(path).join(name);
  }
  files[`${safeName(title)}.md`] = new TextEncoder().encode(markdown);
  downloadBlob(
    `${safeName(title)}.zip`,
    zipSync(files, { level: 0 }),
    "application/zip",
  );
}
