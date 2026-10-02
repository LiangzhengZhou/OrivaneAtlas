import { expect, it } from "vitest";
import { applyWorkspaceChanges, workspaceChanges } from "./workspace-changes";

it("reconciles changed and removed entities while retaining unchanged identities", () => {
  const first = { id: "a", version: 1 },
    second = { id: "b", version: 1 };
  const previous = {
    items: [first, second],
    notes: [{ id: "n" }],
    timezone: "UTC",
  };
  const target = {
    items: [first, { id: "b", version: 2 }, { id: "c", version: 1 }],
    notes: [],
    timezone: "Asia/Shanghai",
  };
  const changes = workspaceChanges(previous, target);
  expect(changes.collections.items?.upserts).toHaveLength(2);
  const result = applyWorkspaceChanges(previous, changes);
  expect(result).toEqual(target);
  expect(result.items[0]).toBe(first);
  expect(applyWorkspaceChanges(result, workspaceChanges(target, target))).toBe(
    result,
  );
});
