import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "vitest";

const bytes = (file: string) => readFileSync(resolve(file));
const hash = (file: string) =>
  createHash("sha256").update(bytes(file)).digest("hex").toUpperCase();

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
    "CB8711F35456A3DED810C8658FE303AAFB95DF35978B88F81046BE8DF33412DC",
  );
  const source = bytes("branding/application-icon-source.png");
  expect(source.readUInt32BE(16)).toBe(1320);
  expect(source.readUInt32BE(20)).toBe(1191);
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
  for (const file of [
    "src-tauri/icons/icon.png",
    "apps/web/public/favicon.png",
    "apps/web/public/application-icon-192.png",
    "apps/web/public/application-icon-512.png",
  ]) {
    const png = bytes(file);
    expect(png.subarray(1, 4).toString()).toBe("PNG");
    expect(png[25]).toBe(6);
  }
});
