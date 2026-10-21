import { randomUUID } from "node:crypto";
import { expect } from "vitest";
import {
  type UnitOfWork,
  WorkflowService,
  WorkService,
} from "../../packages/application/src/index";
import { validateLocalCanonicalWorkflowValue } from "../../packages/application/src/local-canonical-workflow";
import { localDto } from "../../packages/application/src/local-dto";

export async function stablePlanPreviewScenario(uow: UnitOfWork) {
  const actor = { workspaceId: "workspace-a", principalId: "human" },
    auth = { require: async () => {} },
    clock = { now: () => "2026-10-14T00:00:00Z" },
    ids = { next: randomUUID },
    manifest = {
      version: 1,
      tasks: [
        {
          tempId: "task",
          title: "Reviewed",
          descriptionMd: "原文\n第二行",
          dependsOn: [],
        },
      ],
    },
    service = new WorkflowService(uow, auth, clock, ids);
  const original = await service.preview(actor, null, manifest);
  if (original.payload.kind !== "PLAN") throw new Error("MISSING_PLAN");
  const baseline = {
      baseRevision: original.payload.baseRevision,
      documentRevision: original.payload.documentRevision ?? "",
    },
    stableId = randomUUID();
  const preview = await service.previewWithStableId(
    actor,
    stableId,
    null,
    manifest,
    baseline,
  );
  expect(preview.id).toBe(stableId);
  expect(preview.version).toBe(1);
  validateLocalCanonicalWorkflowValue(
    stableId,
    actor.workspaceId,
    1,
    localDto(preview),
  );
  await expect(
    service.previewWithStableId(actor, stableId, null, manifest, baseline),
  ).rejects.toThrow("VERSION_CONFLICT");
  await new WorkService(uow, auth, clock, ids).create(actor, {
    title: "Concurrent change",
  });
  const staleId = randomUUID();
  await expect(
    service.previewWithStableId(actor, staleId, null, manifest, baseline),
  ).rejects.toThrow("VERSION_CONFLICT");
  await uow.run(actor.workspaceId, async (tx) => {
    expect((await tx.workflows()).map((r) => r.id).sort()).toEqual(
      [original.id, stableId].sort(),
    );
    expect((await tx.list()).map((i) => i.title)).toEqual([
      "Concurrent change",
    ]);
  });
}
