import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

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
      const offset = icon.readUInt32LE(frame + 12);
      const length = icon.readUInt32LE(frame + 8);
      expect(offset + length).toBeLessThanOrEqual(icon.length);
      expect(icon.subarray(offset, offset + 8)).toEqual(
        Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
      );
      expect(icon.readUInt32BE(offset + 16)).toBe(size);
      expect(icon.readUInt32BE(offset + 20)).toBe(size);
    });
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
