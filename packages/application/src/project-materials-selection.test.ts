import { expect, it } from "vitest";
import {
  type ProjectKnowledgeBinding,
  selectWritableProjectSpace,
} from "./project-materials";

const binding = (
  id: string,
  spaceId: string,
  role: ProjectKnowledgeBinding["role"],
): ProjectKnowledgeBinding => ({
  id,
  workspaceId: "workspace",
  projectId: "project",
  spaceId,
  ownership: "OWNED",
  role,
  inheritToChildren: true,
  version: 1,
  createdBy: "owner",
  updatedAt: "2026-11-04T00:00:00Z",
});

const live = (id: string) => ({ id, deletedAt: null });
const deleted = (id: string) => ({ id, deletedAt: "2026-11-04T00:00:00Z" });

it("reuses the single live PRIMARY binding regardless of title", () => {
  expect(
    selectWritableProjectSpace(
      [binding("m", "space", "PRIMARY")],
      [live("space")],
    )?.spaceId,
  ).toBe("space");
});

it("does not infer a space from an unbound same-title space", () => {
  expect(selectWritableProjectSpace([], [live("same-title-space")])).toBeNull();
});

it("ignores SUPPORTING and REFERENCE bindings when choosing a writable primary", () => {
  expect(
    selectWritableProjectSpace(
      [
        binding("support", "space-a", "SUPPORTING"),
        binding("reference", "space-b", "REFERENCE"),
      ],
      [live("space-a"), live("space-b")],
    ),
  ).toBeNull();
});

it("rejects multiple live PRIMARY bindings instead of choosing one", () => {
  expect(() =>
    selectWritableProjectSpace(
      [binding("a", "space-a", "PRIMARY"), binding("b", "space-b", "PRIMARY")],
      [live("space-a"), live("space-b")],
    ),
  ).toThrow("VALIDATION_ERROR");
});

it("falls back to creation when the PRIMARY space is deleted", () => {
  expect(
    selectWritableProjectSpace(
      [binding("a", "space-a", "PRIMARY")],
      [deleted("space-a")],
    ),
  ).toBeNull();
});
