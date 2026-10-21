import { IDBFactory } from "fake-indexeddb";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clearDraftStrict,
  type Draft,
  draftMatchesBase,
  loadDraftStrict,
  saveDraft,
} from "./localDrafts";

afterEach(() => vi.unstubAllGlobals());

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
  it("confirms durable draft write and deletion at transaction completion", async () => {
    vi.stubGlobal("indexedDB", new IDBFactory());
    expect(await saveDraft("memo-owner-target", draft)).toBe(true);
    expect(await loadDraftStrict("memo-owner-target")).toEqual(draft);
    await clearDraftStrict("memo-owner-target");
    expect(await loadDraftStrict("memo-owner-target")).toBeNull();
  });
  it("does not represent unavailable draft storage as an empty draft", async () => {
    vi.stubGlobal("indexedDB", {
      open: () => {
        throw new Error("STORAGE_UNAVAILABLE");
      },
    });
    await expect(loadDraftStrict("memo")).rejects.toThrow(
      "STORAGE_UNAVAILABLE",
    );
    await expect(clearDraftStrict("memo")).rejects.toThrow(
      "STORAGE_UNAVAILABLE",
    );
  });
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
