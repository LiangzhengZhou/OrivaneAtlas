const marker = "<!-- orivane-atlas:html-note:v1 -->\n";
const maxBody = 200_000;

export function htmlNoteBody(source: string) {
  let longest = 2;
  for (const match of source.matchAll(/~+/g))
    longest = Math.max(longest, match[0].length);
  const fence = "~".repeat(longest + 1);
  return marker + fence + "html\n" + source + "\n" + fence;
}

export function htmlNoteSource(body: string): string | null {
  if (!body.startsWith(marker)) return null;
  const start = body.indexOf("\n", marker.length);
  const header = body.slice(marker.length, start);
  if (!/^~{3,}html$/.test(header)) return null;
  const end = "\n" + header.slice(0, -4);
  return body.endsWith(end) ? body.slice(start + 1, -end.length) : null;
}

export async function readHtmlNote(file: File) {
  if (!/\.html?$/i.test(file.name) || file.size > 600_000)
    throw new Error("INVALID_HTML_FILE");
  const source = new TextDecoder("utf-8", {
    fatal: true,
    ignoreBOM: true,
  }).decode(await file.arrayBuffer());
  const body = htmlNoteBody(source);
  if (body.length > maxBody) throw new Error("INVALID_HTML_FILE");
  const template = document.createElement("template");
  template.innerHTML = source;
  const title =
    template.content.querySelector("title")?.textContent?.trim() ||
    file.name.replace(/\.html?$/i, "") ||
    file.name;
  return { title: title.slice(0, 240), body };
}

const elements = new Set(
  "a abbr address article aside b bdi bdo blockquote br caption cite code col colgroup dd del details dfn div dl dt em figcaption figure footer h1 h2 h3 h4 h5 h6 header hr i img ins kbd li main mark nav ol p pre q rp rt ruby s samp section small span strong style sub summary sup table tbody td tfoot th thead time tr u ul var wbr".split(
    " ",
  ),
);
const attributes = new Set(
  "alt class colspan dir height id lang open reversed role rowspan scope start style title width".split(
    " ",
  ),
);

export function htmlReadingDocument(source: string) {
  const template = document.createElement("template");
  template.innerHTML = source;
  for (const el of template.content.querySelectorAll("*")) {
    if (
      el.namespaceURI !== "http://www.w3.org/1999/xhtml" ||
      !elements.has(el.localName)
    ) {
      el.remove();
      continue;
    }
    for (const attr of Array.from(el.attributes)) {
      if (attributes.has(attr.name)) continue;
      if (
        el.localName === "img" &&
        attr.name === "src" &&
        /^data:image\/(?:png|jpeg|webp|gif);base64,[a-z\d+/=\s]+$/i.test(
          attr.value,
        )
      )
        continue;
      if (
        el.localName === "a" &&
        attr.name === "href" &&
        /^#[\p{L}\p{M}\p{N}_.-]+$/u.test(attr.value)
      ) {
        el.setAttribute("href", "about:srcdoc" + attr.value);
        continue;
      }
      el.removeAttribute(attr.name);
    }
  }
  return (
    '<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'; img-src data:; base-uri \'none\'; form-action \'none\'"><meta name="viewport" content="width=device-width, initial-scale=1"><style>:root{color-scheme:light dark}body{font:1rem/1.55 system-ui,sans-serif;overflow-wrap:anywhere;margin:1rem}img{max-width:100%;height:auto}table{border-collapse:collapse}td,th{border:1px solid GrayText;padding:.25em .5em}pre{white-space:pre-wrap}</style>' +
    template.innerHTML
  );
}
