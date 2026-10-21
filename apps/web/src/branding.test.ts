import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { inflateSync } from "node:zlib";
import { expect, test } from "vitest";

const bytes = (file: string) => readFileSync(resolve(file));
const hash = (file: string) =>
  createHash("sha256").update(bytes(file)).digest("hex").toUpperCase();

function generatedAlpha(png: Buffer) {
  const width = png.readUInt32BE(16);
  const height = png.readUInt32BE(20);
  const chunks: Buffer[] = [];
  for (let offset = 8; offset < png.length; ) {
    const length = png.readUInt32BE(offset);
    if (png.toString("ascii", offset + 4, offset + 8) === "IDAT")
      chunks.push(png.subarray(offset + 8, offset + 8 + length));
    offset += length + 12;
  }
  const pixels = inflateSync(Buffer.concat(chunks));
  expect(pixels.length).toBe(height * (width * 4 + 1));
  let transparent = 0;
  let visible = 0;
  for (let row = 0; row < height; row++) {
    const start = row * (width * 4 + 1);
    expect(pixels[start]).toBe(0);
    for (let column = 0; column < width; column++) {
      const alpha = pixels[start + 1 + column * 4 + 3]!;
      if (alpha === 0) transparent++;
      else visible++;
    }
  }
  expect(transparent).toBeGreaterThan(0);
  expect(visible).toBeGreaterThan(0);
}

test("Sidebar brand logo remains byte-identical and keeps its independent application reference", () => {
  expect(hash("apps/web/public/orivane-atlas.png")).toBe(
    "12E98E78FD60082975FA0FD655AD1C80C00598186232971AE22CA4971E7BB176",
  );
  expect(bytes("apps/web/src/app/Sidebar.tsx").toString()).toContain(
    'src="/orivane-atlas.png"',
  );
  expect(hash("branding/application-icon-source.png")).not.toBe(
    hash("apps/web/public/orivane-atlas.png"),
  );
});

test("all application platforms derive their packaged icons from the canonical repository source", () => {
  expect(hash("branding/application-icon-source.png")).toBe(
    "A9C57AD8206C14995C7E2E078D53DD222685CA02E793DFE07BC124BB3BC835A0",
  );
  const source = bytes("branding/application-icon-source.png");
  expect(source.readUInt32BE(16)).toBe(1007);
  expect(source.readUInt32BE(20)).toBe(1111);
  expect(source[25]).toBe(6);
  const generator = bytes("scripts/make-native-icons.mjs").toString();
  expect(generator).toContain("branding/application-icon-source.png");
  expect(generator).not.toContain("E:\\DownloadTemp");
  expect(generator).toContain("object-fit:contain");
  const config = JSON.parse(bytes("src-tauri/tauri.conf.json").toString());
  expect(config.bundle.icon).toContain("icons/icon.ico");
  expect(config.bundle.windows.nsis.installerIcon).toBe("icons/icon.ico");
  expect(config.bundle.windows.nsis.uninstallerIcon).toBe("icons/icon.ico");
  const ico = bytes("src-tauri/icons/icon.ico");
  expect(ico.readUInt16LE(0)).toBe(0);
  expect(ico.readUInt16LE(2)).toBe(1);
  const sizes = Array.from(
    { length: ico.readUInt16LE(4) },
    (_, index) => ico[6 + index * 16] || 256,
  );
  expect(sizes).toEqual(expect.arrayContaining([16, 24, 32, 48, 64, 128, 256]));
  for (let index = 0; index < sizes.length; index++) {
    const entry = 6 + index * 16;
    expect(ico.readUInt16LE(entry + 6)).toBe(32);
    const size = ico.readUInt32LE(entry + 8);
    const offset = ico.readUInt32LE(entry + 12);
    generatedAlpha(ico.subarray(offset, offset + size));
  }
  for (const density of ["mdpi", "hdpi", "xhdpi", "xxhdpi", "xxxhdpi"]) {
    for (const name of [
      "ic_launcher",
      "ic_launcher_round",
      "ic_launcher_foreground",
    ]) {
      expect(
        hash(
          `src-tauri/gen/android/app/src/main/res/mipmap-${density}/${name}.png`,
        ),
      ).toBe(hash(`src-tauri/icons/android/mipmap-${density}/${name}.png`));
    }
  }
  expect(
    hash("src-tauri/icons/android/values/ic_launcher_background.xml"),
  ).toBe(
    hash(
      "src-tauri/gen/android/app/src/main/res/values/ic_launcher_background.xml",
    ),
  );
  expect(
    bytes(
      "src-tauri/icons/android/values/ic_launcher_background.xml",
    ).toString(),
  ).toContain("#F3F4F6");
  for (const file of [
    "src-tauri/icons/icon.png",
    "apps/web/public/favicon.png",
    "apps/web/public/application-icon-192.png",
    "apps/web/public/application-icon-512.png",
  ]) {
    const png = bytes(file);
    expect(png.subarray(1, 4).toString()).toBe("PNG");
    expect(png[25]).toBe(6);
    generatedAlpha(png);
  }
});
