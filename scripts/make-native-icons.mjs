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
import { chromium } from "@playwright/test";

// One vector source; Chromium supplies deterministic SVG rasterization without a
// second hand-drawn brand asset or a platform-specific graphics dependency.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const master = await readFile(
  path.join(root, "branding/app-icon-master.svg"),
  "utf8",
);
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
  { padding = 0.08, background = "#ffffff", round = false } = {},
) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(
    `<html><head><style>html,body{margin:0;width:100%;height:100%;background:transparent}main{box-sizing:border-box;width:100%;height:100%;padding:${size * padding}px;background:${background};border-radius:${round ? "50%" : "21%"}}svg{display:block;width:100%;height:100%}</style></head><body><main>${master}</main></body></html>`,
  );
  return page.screenshot({ omitBackground: true });
}
try {
  const frames = [];
  for (const size of [16, 24, 32, 48, 64, 128, 256]) {
    // Keep the compass large enough at 16px while leaving a visible outer margin.
    const bytes = await png(size, { padding: size <= 32 ? 0.025 : 0.06 });
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
  await save(
    "assets/orivane-atlas-android.png",
    await png(512, { padding: 0.1, background: "transparent" }),
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
      await png(108 * scale, { padding: 0.1, background: "transparent" }),
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
  const paths = [...master.matchAll(/<path\b[^>]*d="([^"]+)"/g)]
    .map(
      (match) =>
        `<path android:pathData="${match[1]}" android:strokeColor="#FFFFFFFF" android:strokeWidth="24" android:strokeLineCap="round" android:strokeLineJoin="round" android:fillColor="${match[0].includes("fill=") ? "#FFFFFFFF" : "#00000000"}"/>`,
    )
    .join("");
  const circle =
    '<path android:pathData="M422,256 A166,166 0,1 1,90,256 A166,166 0,1 1,422,256" android:strokeColor="#FFFFFFFF" android:strokeWidth="26" android:fillColor="#00000000"/>';
  await save(
    "src-tauri/icons/android/drawable/atlas_notification.xml",
    `<vector xmlns:android="http://schemas.android.com/apk/res/android" android:width="24dp" android:height="24dp" android:viewportWidth="512" android:viewportHeight="512">${circle}${paths}</vector>\n`,
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
    "Generated Windows frames, Android launcher/notification and packaged resources from branding/app-icon-master.svg.",
  );
} finally {
  await browser.close();
}
