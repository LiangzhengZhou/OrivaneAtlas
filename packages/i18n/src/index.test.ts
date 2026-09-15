import { describe, expect, it } from "vitest";
import { createI18n, resolveLocale, resources } from "./index";

function flatten(
  input: Record<string, unknown>,
  prefix = "",
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(input).flatMap(([key, value]) => {
      const path = prefix ? `${prefix}.${key}` : key;
      return typeof value === "string"
        ? [[path, value]]
        : Object.entries(flatten(value as Record<string, unknown>, path));
    }),
  );
}
describe("Internationalization", () => {
  it("keeps locale keys and interpolation parameters in parity", () => {
    const en = flatten(resources["en-US"]);
    const zh = flatten(resources["zh-CN"]);
    expect(Object.keys(zh).sort()).toEqual(Object.keys(en).sort());
    for (const [key, value] of Object.entries(en)) {
      expect(zh[key]?.length).toBeGreaterThan(0);
      expect(zh[key]?.match(/\{\{[^}]+\}\}/g) ?? []).toEqual(
        value.match(/\{\{[^}]+\}\}/g) ?? [],
      );
    }
  });
  it("resolves explicit preference before device locale and has English fallback", () => {
    expect(resolveLocale("en-US", "zh-CN")).toBe("en-US");
    expect(resolveLocale("system", "zh-TW")).toBe("zh-CN");
    expect(resolveLocale(null, "fr-FR")).toBe("en-US");
  });
  it("switches at runtime while leaving interpolated user content untouched", async () => {
    const i18n = await createI18n("en-US");
    expect(i18n.t("create")).toBe("Create task");
    await i18n.changeLanguage("zh-CN");
    expect(i18n.t("create")).toBe("新建任务");
    expect(i18n.t("openTask", { title: "Untouched title" })).toContain(
      "Untouched title",
    );
  });
});
