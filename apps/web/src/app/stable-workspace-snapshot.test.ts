import { expect, it } from "vitest";
import type { Snapshot } from "../bootstrap";
import { stableWorkspaceSnapshot } from "./stable-workspace-snapshot";

it("shares only fully equal UI collections and retains canonical corrections at the same version", () => {
  const previous = {
    items: [
      { id: "task", workspaceId: "workspace", version: 1, title: "Task" },
    ],
    library: [{ id: "document", version: 1, title: "Original" }],
    notes: [],
    edges: [],
    links: [],
    organization: [],
    projectMaterials: [],
  } as unknown as Snapshot;
  const equivalent = structuredClone(previous);
  const unchanged = stableWorkspaceSnapshot(previous, equivalent);
  expect(unchanged.items).toBe(previous.items);
  expect(unchanged.library).toBe(equivalent.library);
  expect(unchanged.notes).toBe(equivalent.notes);
  const next = structuredClone(previous);
  Object.assign(next.items[0]!, { title: "Canonical correction" });
  const shared = stableWorkspaceSnapshot(previous, next);
  expect(shared.items).toBe(next.items);
  expect(shared.edges).toBe(previous.edges);
  expect(shared.library).toBe(next.library);
  expect(shared.items[0]!.title).toBe("Canonical correction");
  expect(previous.items[0]!.title).toBe("Task");
  const foreign = structuredClone(previous);
  Object.assign(foreign.items[0]!, { workspaceId: "other" });
  expect(stableWorkspaceSnapshot(previous, foreign).items).toBe(foreign.items);
  Object.assign(previous.items[0]!, { title: "Caller mutation" });
  expect(stableWorkspaceSnapshot(previous, next).items).toBe(next.items);
});

it("retains removal, ordering and derived-state changes without mutating the input", () => {
  const previous = {
    items: [],
    notes: [{ id: "a" }, { id: "b" }],
    files: [{ id: "file", version: 1, indexStatus: "PENDING" }],
    calendarTimezone: "UTC",
    library: [],
    edges: [],
    links: [],
    organization: [],
    projectMaterials: [],
  } as unknown as Snapshot;
  const next = structuredClone(previous);
  next.notes.reverse();
  Object.assign(next.files![0]!, { indexStatus: "FAILED" });
  Reflect.deleteProperty(next, "calendarTimezone");
  const expected = structuredClone(next);
  const result = stableWorkspaceSnapshot(previous, next);
  expect(result).toEqual(expected);
  expect(next).toEqual(expected);
  expect(Object.hasOwn(result, "calendarTimezone")).toBe(false);
  expect(result.files).toBe(next.files);
  expect(result.notes).toBe(next.notes);
  expect(result.items).toBe(previous.items);
});
