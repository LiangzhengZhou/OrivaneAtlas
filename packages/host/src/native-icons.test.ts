import { readFileSync } from "node:fs";
import { inflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";

function assertTransparentRgba(png: Buffer) {
  expect(png[25]).toBe(6);
  const width = png.readUInt32BE(16),
    height = png.readUInt32BE(20);
  const chunks: Buffer[] = [];
  for (let offset = 8; offset < png.length; ) {
    const length = png.readUInt32BE(offset);
    if (png.toString("ascii", offset + 4, offset + 8) === "IDAT")
      chunks.push(png.subarray(offset + 8, offset + 8 + length));
    offset += length + 12;
  }
  const scanlines = inflateSync(Buffer.concat(chunks));
  expect(scanlines.length).toBe(height * (width * 4 + 1));
  let transparent = 0,
    visible = 0;
  for (let y = 0; y < height; y++) {
    const start = y * (width * 4 + 1);
    expect(scanlines[start]).toBe(0);
    for (let x = 0; x < width; x++) {
      const alpha = scanlines[start + 1 + x * 4 + 3]!;
      if (alpha === 0) transparent++;
      else visible++;
    }
  }
  expect(transparent).toBeGreaterThan(width * height * 0.4);
  expect(visible).toBeGreaterThan(width * height * 0.02);
  expect(scanlines[4]).toBe(0);
}

describe("generated application brand", () => {
  it("contains every required Windows frame with valid embedded PNG dimensions", () => {
    const icon = readFileSync("src-tauri/icons/icon.ico");
    expect(icon.readUInt16LE(0)).toBe(0);
    expect(icon.readUInt16LE(2)).toBe(1);
    expect(icon.readUInt16LE(4)).toBe(7);
    [16, 24, 32, 48, 64, 128, 256].forEach((size, index) => {
      const frame = 6 + index * 16;
      expect(icon[frame] || 256).toBe(size);
      expect(icon[frame + 1] || 256).toBe(size);
      expect(icon.readUInt16LE(frame + 6)).toBe(32);
      const offset = icon.readUInt32LE(frame + 12);
      const length = icon.readUInt32LE(frame + 8);
      expect(offset + length).toBeLessThanOrEqual(icon.length);
      expect(icon.subarray(offset, offset + 8)).toEqual(
        Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
      );
      expect(icon.readUInt32BE(offset + 16)).toBe(size);
      expect(icon.readUInt32BE(offset + 20)).toBe(size);
      assertTransparentRgba(icon.subarray(offset, offset + length));
    });
  });
  it("preserves alpha in normal web, Tauri and legacy Android icons with an independent adaptive background", () => {
    for (const file of [
      "src-tauri/icons/icon.png",
      "apps/web/public/favicon.png",
      "apps/web/public/application-icon-192.png",
      "apps/web/public/application-icon-512.png",
    ])
      assertTransparentRgba(readFileSync(file));
    for (const density of ["mdpi", "hdpi", "xhdpi", "xxhdpi", "xxxhdpi"])
      for (const name of [
        "ic_launcher",
        "ic_launcher_round",
        "ic_launcher_foreground",
      ])
        assertTransparentRgba(
          readFileSync(`src-tauri/icons/android/mipmap-${density}/${name}.png`),
        );
    const background = readFileSync(
      "src-tauri/icons/android/values/ic_launcher_background.xml",
      "utf8",
    );
    expect(background).toContain("#71777f");
    expect(background).not.toContain("#172033");
  });
  it("wires the real Android notification and adaptive launcher resources", () => {
    const base = "src-tauri/gen/android/app/src/main/";
    expect(
      readFileSync(
        `${base}java/app/orivane/atlas/AtlasNotificationPlugin.kt`,
        "utf8",
      ),
    ).toContain("R.drawable.atlas_notification");
    expect(
      readFileSync(`${base}res/mipmap-anydpi-v26/ic_launcher.xml`, "utf8"),
    ).toContain("@drawable/atlas_launcher_safe_foreground");
    expect(readFileSync(`${base}res/drawable/atlas_notification.xml`)).toEqual(
      readFileSync("src-tauri/icons/android/drawable/atlas_notification.xml"),
    );
  });
});
