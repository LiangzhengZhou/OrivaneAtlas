import { describe, expect, it } from "vitest";
import { isLocalJson } from "./json";

describe("local metadata boundary", () => {
  it("accepts nested JSON and repeated noncyclic references", () => {
    const item = { title: "preserved Markdown\nsecond line", version: 1 };
    expect(
      isLocalJson({ items: [item, item], deletedAt: null, enabled: true }),
    ).toBe(true);
  });
  it("rejects binary, nonfinite numbers, dates and cycles", () => {
    for (const value of [
      new Blob(["original bytes"]),
      new Uint8Array([1, 2]),
      new Date(),
      Infinity,
      NaN,
      undefined,
    ])
      expect(isLocalJson({ value })).toBe(false);
    const cyclic: { self?: unknown } = {};
    cyclic.self = cyclic;
    expect(isLocalJson(cyclic)).toBe(false);
  });
  it("does not invoke accessors during validation", () => {
    let invoked = false;
    const value = Object.defineProperty({}, "secret", {
      get() {
        invoked = true;
        return "not metadata";
      },
    });
    expect(isLocalJson(value)).toBe(false);
    expect(invoked).toBe(false);
  });
  it("rejects data that JSON would silently drop or substitute", () => {
    expect(isLocalJson(Array(2))).toBe(false);
    expect(isLocalJson(Object.assign(["body"], { extra: "lost text" }))).toBe(
      false,
    );
    expect(
      isLocalJson(Object.defineProperty({}, "bodyMd", { value: "lost text" })),
    ).toBe(false);
    const values = ["first", "second"];
    delete values[0];
    expect(isLocalJson(values)).toBe(false);
    expect(isLocalJson(["first", "second"])).toBe(true);
  });
});
