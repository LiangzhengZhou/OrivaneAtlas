import { describe, expect, it } from "vitest";
import { type Draft, draftMatchesBase } from "./localDrafts";

const base = { version: 3, updatedAt: "2026-09-19T00:00:00Z" };
const draft: Draft = {
  title: "Draft",
  body: "private",
  updatedAt: 1,
  savedAt: 1,
  entityId: "note",
  baseVersion: 3,
  baseUpdatedAt: base.updatedAt,
};
describe("versioned draft recovery", () => {
  it("permits autosave only for an exact entity and revision match", () => {
    expect(draftMatchesBase(draft, "note", base)).toBe(true);
    expect(draftMatchesBase(draft, "other", base)).toBe(false);
    expect(draftMatchesBase(draft, "note", { ...base, version: 4 })).toBe(
      false,
    );
    expect(draftMatchesBase(draft, "note", { ...base, version: 2 })).toBe(
      false,
    );
    expect(
      draftMatchesBase(draft, "note", { ...base, updatedAt: "different" }),
    ).toBe(false);
  });
  it("requires explicit recovery for legacy drafts and distinguishes unsaved documents", () => {
    expect(
      draftMatchesBase(
        { title: "old", body: "source", updatedAt: 1 },
        "note",
        base,
      ),
    ).toBe(false);
    expect(
      draftMatchesBase(
        { ...draft, entityId: "new", baseVersion: 0, baseUpdatedAt: null },
        "new",
      ),
    ).toBe(true);
    expect(draftMatchesBase(draft, "note")).toBe(false);
  });
});
