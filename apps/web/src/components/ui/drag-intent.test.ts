import { describe, expect, it } from "vitest";
import { acceptsReorder, readEntityDrag } from "./drag-intent";

describe("drag intent boundary", () => {
  const payload = {
    version: 1,
    intent: "REORDER",
    entityId: "a",
    scopeKey: "project:p",
  };
  it("requires an explicit valid protocol instead of naked text IDs", () => {
    expect(readEntityDrag("a")).toBeNull();
    expect(readEntityDrag(JSON.stringify(payload))).toEqual(payload);
    for (const change of [
      { version: 2 },
      { intent: "WRITE" },
      { entityId: "" },
      { scopeKey: 4 },
    ])
      expect(
        readEntityDrag(JSON.stringify({ ...payload, ...change })),
      ).toBeNull();
    expect(readEntityDrag("x".repeat(2049))).toBeNull();
  });
  it("does not interpret board/reparent or another scope as sibling reorder", () => {
    const input = readEntityDrag(JSON.stringify(payload));
    expect(acceptsReorder(input, "REORDER", "project:p", "b")).toBe(true);
    expect(acceptsReorder(input, "REORDER", "project:q", "b")).toBe(false);
    expect(acceptsReorder(input, "REORDER", "project:p", "a")).toBe(false);
    expect(acceptsReorder(input, "NAV_REORDER", "project:p", "b")).toBe(false);
    expect(
      acceptsReorder(
        readEntityDrag(JSON.stringify({ ...payload, intent: "MOVE_STATUS" })),
        "REORDER",
        "project:p",
        "b",
      ),
    ).toBe(false);
  });
  it.each(["PROJECT_REPARENT", "MOVE_CATEGORY"] as const)(
    "%s cannot be replayed as an insertion or navigation reorder",
    (intent) => {
      const input = readEntityDrag(JSON.stringify({ ...payload, intent }));
      expect(input?.intent).toBe(intent);
      expect(acceptsReorder(input, "REORDER", "project:p", "b")).toBe(false);
      expect(acceptsReorder(input, "NAV_REORDER", "project:p", "b")).toBe(
        false,
      );
    },
  );
});
