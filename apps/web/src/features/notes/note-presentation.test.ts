import { describe, expect, it } from "vitest";
import {
  groupJournalEntries,
  journalGroupKey,
  journalGroupLabel,
  parseNotePresentation,
} from "./note-presentation";

describe("journal calendar grouping", () => {
  it("keeps Monday–Sunday weeks together across years and leap days", () => {
    expect(journalGroupKey("2026-01-01", "week")).toBe("2025-12-29");
    expect(journalGroupKey("2026-01-04", "week")).toBe("2025-12-29");
    expect(journalGroupKey("2026-01-05", "week")).toBe("2026-01-05");
    expect(journalGroupKey("2024-02-29", "week")).toBe("2024-02-26");
    expect(journalGroupKey("2024-02-29", "month")).toBe("2024-02");
    expect(journalGroupKey("2024-02-29", "year")).toBe("2024");
    expect(journalGroupKey("2024-02-29", "day")).toBe("2024-02-29");
  });
  it("retains undated/invalid legacy entries without silently moving them to another day", () => {
    const entries = [
      { id: "old", day: "2025-02-29" },
      { id: "none", day: null },
      { id: "new", day: "2026-10-20" },
      { id: "older", day: "2025-12-31" },
    ];
    expect(
      groupJournalEntries(entries, "year").map(([key, notes]) => [
        key,
        notes.map((note) => note.id),
      ]),
    ).toEqual([
      ["2026", ["new"]],
      ["2025", ["older"]],
      ["undated", ["old", "none"]],
    ]);
    expect(groupJournalEntries(entries, "none")).toEqual([["all", entries]]);
    expect(entries[0]!.day).toBe("2025-02-29");
  });
  it("uses calendar labels independent of the machine timezone and localizes both languages", () => {
    expect(journalGroupLabel("2026-10", "month", "en-US")).toBe("October 2026");
    expect(journalGroupLabel("2026-10", "month", "zh-CN")).toBe("2026年10月");
    expect(journalGroupLabel("2025-12-29", "week", "en-US")).toContain("2026");
    expect(journalGroupLabel("2025-12-29", "week", "zh-CN")).toContain("2025");
  });
});

it("validates persisted display enums and never restores content or collapsed identities", () => {
  expect(parseNotePresentation("not json", true)).toEqual({
    layout: "list",
    grouping: "month",
    sort: "day",
    collapsed: [],
  });
  expect(
    parseNotePresentation(
      '{"layout":"huge","grouping":"year","sort":"day","collapsed":["2026"]}',
      false,
    ),
  ).toEqual({
    layout: "list",
    grouping: "none",
    sort: "updated",
    collapsed: [],
  });
  expect(
    parseNotePresentation(
      '{"layout":"large","grouping":"week","sort":"title","collapsed":["2026"]}',
      true,
    ),
  ).toEqual({
    layout: "large",
    grouping: "week",
    sort: "title",
    collapsed: [],
  });
});
