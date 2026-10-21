import { expect, it } from "vitest";
import {
  requireCanonicalProjectMaterial,
  requireLegacyProjectOriginalLifecycle,
  requireProjectMaterialReplica,
} from "./project-knowledge-replay-effects";

const original = {
  id: "original",
  workspaceId: "workspace",
  projectId: "project",
  kind: "FILE",
  ownership: "OWNED",
  targetId: null,
  title: "Original.bin",
  mime: "application/octet-stream",
  size: 6,
  version: 2,
  updatedBy: "owner",
  updatedAt: "2026-10-19T00:00:00Z",
  deletedAt: null,
};
it("legacy lifecycle preserves original identity and rejects content/ownership changes", () => {
  const base = requireProjectMaterialReplica(
    original,
    original.id,
    original.workspaceId,
    2,
  );
  const deleted = {
    ...base,
    version: 3,
    deletedAt: "2026-10-19T01:00:00Z",
    updatedAt: "2026-10-19T01:00:00Z",
  };
  expect(requireLegacyProjectOriginalLifecycle(base, deleted, 2)).toEqual(
    deleted,
  );
  for (const patch of [
    { title: "Different.bin" },
    { size: 4 },
    { projectId: "other" },
    { version: 4 },
    { mime: "text/plain" },
  ]) {
    expect(() =>
      requireLegacyProjectOriginalLifecycle(base, { ...deleted, ...patch }, 2),
    ).toThrow();
  }
});
it("accepts bounded legacy metadata only through the read replica contract, never the new write contract", () => {
  expect(
    requireProjectMaterialReplica(
      original,
      original.id,
      original.workspaceId,
      2,
    ),
  ).toEqual(original);
  expect(() =>
    requireCanonicalProjectMaterial(
      original,
      original.id,
      original.workspaceId,
      2,
    ),
  ).toThrow("VALIDATION_ERROR");
});
it.each([
  { workspaceId: "other" },
  { id: "other" },
  { version: 1 },
  { ownership: "LINKED" },
  { targetId: "document" },
  { size: 2097153 },
  { size: 0 },
  { mime: "invalid" },
  { title: "../original" },
  { base64: "AA==" },
  { updatedAt: "invalid" },
])("rejects invalid legacy replica metadata %j", (patch) => {
  expect(() =>
    requireProjectMaterialReplica(
      { ...original, ...patch },
      original.id,
      original.workspaceId,
      2,
    ),
  ).toThrow("VALIDATION_ERROR");
});
