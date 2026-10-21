import { describe, expect, it } from "vitest";
import { surfaceAction } from "./interaction-intent";

describe("surface intent", () => {
  it("opens destinations immediately and does not reopen on double click", () => {
    expect(surfaceAction("NAVIGATE", "CLICK")).toBe("OPEN");
    expect(surfaceAction("NAVIGATE", "ENTER")).toBe("OPEN");
    expect(surfaceAction("NAVIGATE", "SPACE")).toBe("OPEN");
    expect(surfaceAction("NAVIGATE", "DOUBLE_CLICK")).toBeNull();
  });
  it.each(["SELECT", "INSPECT"] as const)(
    "keeps %s exploration on the surface until explicitly opened",
    (intent) => {
      expect(surfaceAction(intent, "CLICK")).toBe("SELECT");
      expect(surfaceAction(intent, "SPACE")).toBe("SELECT");
      expect(surfaceAction(intent, "ENTER")).toBe("OPEN");
      expect(surfaceAction(intent, "DOUBLE_CLICK")).toBe("OPEN");
    },
  );
});
