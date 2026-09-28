function safeName(value: string) {
  return (value.trim().replace(/[^\p{L}\p{N}._-]+/gu, "-") || "document").slice(
    0,
    80,
  );
}
function crc32(bytes: Uint8Array) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++)
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function word(value: number) {
  return new Uint8Array([value & 255, (value >>> 8) & 255]);
}
function dword(value: number) {
  return new Uint8Array([
    value & 255,
    (value >>> 8) & 255,
    (value >>> 16) & 255,
    (value >>> 24) & 255,
  ]);
}
function join(parts: Uint8Array[]) {
  const result = new Uint8Array(
    parts.reduce((sum, part) => sum + part.length, 0),
  );
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}
function zip(files: { name: string; data: Uint8Array }[]) {
  const locals: Uint8Array[] = [],
    central: Uint8Array[] = [];
  let offset = 0;
  for (const file of files) {
    const name = new TextEncoder().encode(file.name),
      crc = crc32(file.data);
    const local = join([
      new Uint8Array([80, 75, 3, 4]),
      word(20),
      word(0),
      word(0),
      word(0),
      word(0),
      dword(crc),
      dword(file.data.length),
      dword(file.data.length),
      word(name.length),
      word(0),
      name,
      file.data,
    ]);
    locals.push(local);
    central.push(
      join([
        new Uint8Array([80, 75, 1, 2]),
        word(20),
        word(20),
        word(0),
        word(0),
        word(0),
        word(0),
        dword(crc),
        dword(file.data.length),
        dword(file.data.length),
        word(name.length),
        word(0),
        word(0),
        word(0),
        word(0),
        dword(offset),
        name,
      ]),
    );
    offset += local.length;
  }
  const body = join([...locals, ...central]),
    centralSize = central.reduce((sum, part) => sum + part.length, 0);
  return join([
    body,
    new Uint8Array([80, 75, 5, 6]),
    word(0),
    word(0),
    word(files.length),
    word(files.length),
    dword(centralSize),
    dword(body.length - centralSize),
    word(0),
  ]);
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
          /!\[[^\]]*\]\((\/api\/library\/asset\?id=[A-Za-z0-9-]+)\)/g,
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
          /!\[[^\]]*\]\((\/api\/library\/asset\?id=[A-Za-z0-9-]+)\)/g,
        ),
      ]
        .map((match) => match[1])
        .filter((path): path is string => !!path),
    ),
  ];
  const files: { name: string; data: Uint8Array }[] = [
    { name: `${safeName(title)}.md`, data: new TextEncoder().encode(body) },
  ];
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
    files.push({ name, data: new Uint8Array(await blob.arrayBuffer()) });
    markdown = markdown.split(path).join(name);
  }
  files[0]!.data = new TextEncoder().encode(markdown);
  downloadBlob(`${safeName(title)}.zip`, zip(files), "application/zip");
}
