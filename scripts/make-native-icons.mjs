import {
  copyFile,
  mkdir,
  readdir,
  readFile,
  rename,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { crc32, deflateSync } from "node:zlib";
import { chromium } from "@playwright/test";

// All application icon resources derive from the repository PNG source.
// The Sidebar wordmark and Android monochrome status glyph remain separate assets.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// Preserve the pale source artwork; one contrasting backplate also keeps the
// smallest Windows frames legible without tinting, cropping or redrawing it.
const applicationBackground = "#172033";
const master = (
  await readFile(path.join(root, "branding/application-icon-source.png"))
).toString("base64");
const browser = await chromium.launch();
const page = await browser.newPage();
async function save(relative, bytes) {
  const target = path.join(root, relative);
  await mkdir(path.dirname(target), { recursive: true });
  try {
    if ((await readFile(target)).equals(Buffer.from(bytes))) return;
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const temporary = `${target}.pending`;
  await writeFile(temporary, bytes);
  await rename(temporary, target);
}
async function png(
  size,
  { padding = 0, background = applicationBackground, round = false } = {},
) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(
    `<html><head><style>html,body{margin:0;width:100%;height:100%;background:transparent}main{box-sizing:border-box;width:100%;height:100%;padding:${size * padding}px;background:${background};border-radius:${round ? "50%" : "21%"}}img{display:block;width:100%;height:100%;object-fit:contain}</style></head><body><main><img src="data:image/png;base64,${master}" /></main></body></html>`,
  );
  await page.locator("img").evaluate((img) => img.decode());
  const capture = await page.screenshot({ omitBackground: true });
  const pixels = await page.evaluate(async (encoded) => {
    const image = new Image();
    image.src = `data:image/png;base64,${encoded}`;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = image.width;
    canvas.height = image.height;
    const context = canvas.getContext("2d");
    context.drawImage(image, 0, 0);
    const bytes = context.getImageData(0, 0, image.width, image.height).data;
    let binary = "";
    for (let start = 0; start < bytes.length; start += 32768)
      binary += String.fromCharCode(...bytes.subarray(start, start + 32768));
    return btoa(binary);
  }, capture.toString("base64"));
  // Chromium may optimize opaque screenshots to RGB; Tauri's mobile context
  // requires an RGBA PNG. Preserve every pixel and explicitly encode color type 6.
  const raw = Buffer.from(pixels, "base64");
  const scanlines = Buffer.alloc(size * (size * 4 + 1));
  for (let row = 0; row < size; row++)
    raw.copy(
      scanlines,
      row * (size * 4 + 1) + 1,
      row * size * 4,
      (row + 1) * size * 4,
    );
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8;
  header[9] = 6;
  const chunk = (type, data) => {
    const body = Buffer.concat([Buffer.from(type), data]);
    const result = Buffer.alloc(body.length + 8);
    result.writeUInt32BE(data.length, 0);
    body.copy(result, 4);
    result.writeUInt32BE(crc32(body), result.length - 4);
    return result;
  };
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(scanlines)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
try {
  const frames = [];
  for (const size of [16, 24, 32, 48, 64, 128, 256]) {
    // Keep the compass large enough at 16px while leaving a visible outer margin.
    const bytes = await png(size, { padding: 0 });
    frames.push({ size, bytes });
    await save(`src-tauri/icons/${size}x${size}.png`, bytes);
  }
  const directory = Buffer.alloc(6 + frames.length * 16);
  directory.writeUInt16LE(1, 2);
  directory.writeUInt16LE(frames.length, 4);
  let offset = directory.length;
  frames.forEach(({ size, bytes }, index) => {
    const start = 6 + index * 16;
    directory[start] = size === 256 ? 0 : size;
    directory[start + 1] = size === 256 ? 0 : size;
    directory.writeUInt16LE(1, start + 4);
    directory.writeUInt16LE(32, start + 6);
    directory.writeUInt32LE(bytes.length, start + 8);
    directory.writeUInt32LE(offset, start + 12);
    offset += bytes.length;
  });
  await save(
    "src-tauri/icons/icon.ico",
    Buffer.concat([directory, ...frames.map((frame) => frame.bytes)]),
  );
  await save("src-tauri/icons/icon.png", await png(512));
  const icnsParts = [];
  for (const [code, size] of [
    ["icp4", 16],
    ["icp5", 32],
    ["icp6", 64],
    ["ic07", 128],
    ["ic08", 256],
    ["ic09", 512],
    ["ic10", 1024],
  ]) {
    const bytes = await png(size);
    const header = Buffer.alloc(8);
    header.write(code);
    header.writeUInt32BE(bytes.length + 8, 4);
    icnsParts.push(header, bytes);
  }
  const icnsHeader = Buffer.alloc(8);
  icnsHeader.write("icns");
  icnsHeader.writeUInt32BE(
    8 + icnsParts.reduce((total, part) => total + part.length, 0),
    4,
  );
  await save(
    "src-tauri/icons/icon.icns",
    Buffer.concat([icnsHeader, ...icnsParts]),
  );
  await save("src-tauri/icons/128x128@2x.png", await png(256));
  await save("assets/orivane-atlas-icon.png", await png(512));
  await save("apps/web/public/favicon.png", await png(32));
  await save("apps/web/public/application-icon-192.png", await png(192));
  await save("apps/web/public/application-icon-512.png", await png(512));
  await save(
    "assets/orivane-atlas-android.png",
    await png(512, { padding: 0.22, background: "transparent" }),
  );
  for (const name of await readdir(path.join(root, "src-tauri/icons"))) {
    const store = /^Square(\d+)x\d+Logo\.png$/.exec(name);
    if (store || name === "StoreLogo.png")
      await save(
        `src-tauri/icons/${name}`,
        await png(store ? Number(store[1]) : 50),
      );
  }
  for (const name of await readdir(path.join(root, "src-tauri/icons/ios"))) {
    const match =
      /^AppIcon-(\d+(?:\.\d+)?)(?:x[\d.]+)?@(\d)x(?:-\d)?\.png$/.exec(name);
    if (match)
      await save(
        `src-tauri/icons/ios/${name}`,
        await png(Math.round(Number(match[1]) * Number(match[2]))),
      );
  }
  for (const [density, scale] of [
    ["mdpi", 1],
    ["hdpi", 1.5],
    ["xhdpi", 2],
    ["xxhdpi", 3],
    ["xxxhdpi", 4],
  ]) {
    await save(
      `src-tauri/icons/android/mipmap-${density}/ic_launcher_foreground.png`,
      await png(108 * scale, { padding: 0.22, background: "transparent" }),
    );
    await save(
      `src-tauri/icons/android/mipmap-${density}/ic_launcher.png`,
      await png(48 * scale),
    );
    await save(
      `src-tauri/icons/android/mipmap-${density}/ic_launcher_round.png`,
      await png(48 * scale, { round: true }),
    );
  }
  await save(
    "src-tauri/icons/android/values/ic_launcher_background.xml",
    Buffer.from(
      `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n  <color name="ic_launcher_background">${applicationBackground}</color>\n</resources>\n`,
    ),
  );
  async function mirror(relative) {
    const from = path.join(root, "src-tauri/icons/android", relative);
    for (const entry of await readdir(from, { withFileTypes: true })) {
      const next = path.join(relative, entry.name);
      if (entry.isDirectory()) await mirror(next);
      else {
        const target = path.join(
          root,
          "src-tauri/gen/android/app/src/main/res",
          next,
        );
        await mkdir(path.dirname(target), { recursive: true });
        await copyFile(path.join(from, entry.name), target);
      }
    }
  }
  await mirror("");
  console.log(
    "Generated Windows frames, Android launcher and packaged application resources from branding/application-icon-source.png.",
  );
} finally {
  await browser.close();
}
