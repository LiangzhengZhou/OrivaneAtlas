import { DomainError } from "@arclattice/domain";
import { expect, it, vi } from "vitest";
import { CategoryService } from "./categories";
import { buildLocalCategoryReplayRequest } from "./local-category-replay-request";
import type { LocalCommandPlan } from "./local-command-plan";
import type { LocalMetadataStore, LocalSyncState } from "./local-persistence";
import { prepareLocalWorkReplayAcknowledgement } from "./local-work-replay-ack";

const commandId = "11111111-1111-4111-8111-111111111111",
  deviceId = "22222222-2222-4222-8222-222222222222",
  categoryId = "33333333-3333-4333-8333-333333333333";
const actor = { workspaceId: "local", principalId: "owner" },
  binding: LocalSyncState = {
    workspaceId: "local",
    remoteWorkspaceId: "remote",
    remotePrincipalId: "human",
    serverOrigin: "https://example.test",
    epoch: "epoch",
    cursor: 1,
    version: 1,
  };
const metadata: LocalMetadataStore = {
  get: vi.fn(async () => null),
  list: vi.fn(async () => []),
  commit: vi.fn(async () => {}),
};
function fixture(): LocalCommandPlan {
  return {
    id: commandId,
    state: "RECEIPT_REQUIRED",
    mutationIds: [commandId],
    command: {
      name: "category.save",
      input: {
        id: categoryId,
        create: true,
        input: { version: 0, name: "Category", deleted: false },
      },
    },
    mutations: [
      {
        id: commandId,
        commandId,
        deviceId,
        workspaceId: "local",
        principalId: "owner",
        entityType: "categories",
        entityId: categoryId,
        operation: "CREATE",
        baseVersion: 0,
        payload: { name: "Must not serialize newer projection" },
        createdAt: "2026-10-13T00:00:00Z",
        state: "SENDING",
        attemptCount: 1,
        lastAttemptAt: "2026-10-13T00:01:00Z",
      },
    ],
  };
}
it("Category stable allocation checks authorization before UUID validation and category lookup", async () => {
  const run = vi.fn(async (): Promise<never> => {
    throw new Error("MUST_NOT_LOOK_UP");
  });
  const service = new CategoryService(
    { run },
    {
      require: async () => {
        throw new DomainError("FORBIDDEN");
      },
    },
    { now: () => "2026-10-13T00:00:00Z" },
    { next: () => categoryId },
  );
  await expect(
    service.createWithStableId(actor, "invalid", {
      version: 0,
      name: "Private",
      deleted: false,
    }),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  expect(run).not.toHaveBeenCalled();
});
it("Category original save keeps stable UUID and canonical ACK preserves later local edits", async () => {
  const plan = fixture();
  expect(buildLocalCategoryReplayRequest(plan)).toMatchObject({
    path: "/api/v1/categories/save",
    idempotencyKey: commandId,
    body: {
      stableId: categoryId,
      deviceId,
      version: 0,
      name: "Category",
      deleted: false,
    },
  });
  const value = {
    id: categoryId,
    workspaceId: "remote",
    version: 1,
    name: "Category",
    icon: "",
    color: "#7863c5",
    position: 0,
    createdBy: "human",
    updatedBy: "human",
    createdAt: "2026-10-13T00:00:00Z",
    updatedAt: "2026-10-13T00:00:00Z",
    deletedAt: null,
  };
  const receipt = {
    commandId,
    deviceId,
    result: value,
    effects: [
      {
        collection: "categories",
        id: categoryId,
        op: "UPSERT",
        version: 1,
        value,
      },
    ],
  };
  const commit = await prepareLocalWorkReplayAcknowledgement(
    actor,
    binding,
    plan,
    receipt,
    plan.mutations,
    metadata,
  );
  expect(
    commit.records.find((record) => record.entity.collection === "categories")
      ?.entity.value,
  ).toEqual({ ...value, workspaceId: "local" });
  const later = {
    ...plan.mutations[0]!,
    id: "later",
    commandId: "later",
    baseVersion: 1,
    state: "PENDING" as const,
    attemptCount: 0,
    lastAttemptAt: null,
  };
  expect(
    (
      await prepareLocalWorkReplayAcknowledgement(
        actor,
        binding,
        plan,
        receipt,
        [...plan.mutations, later],
        metadata,
      )
    ).records.map((record) => record.entity.collection),
  ).toEqual(["$local.remoteBase"]);
  await expect(
    prepareLocalWorkReplayAcknowledgement(
      actor,
      binding,
      plan,
      {
        ...receipt,
        effects: [
          { ...receipt.effects[0], value: { ...value, color: "not-a-color" } },
        ],
      },
      plan.mutations,
      metadata,
    ),
  ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
});
it("Category reorder retains unchanged members in original intent and rejects partial or wrong-version groups", () => {
  const base = fixture(),
    mutation = base.mutations[0]!;
  const plan: LocalCommandPlan = {
    ...base,
    command: {
      name: "category.reorder",
      input: {
        ordered: [
          { id: categoryId, version: 1 },
          { id: "unchanged", version: 4 },
        ],
      },
    },
    mutations: [{ ...mutation, operation: "PATCH", baseVersion: 1 }],
  };
  expect(buildLocalCategoryReplayRequest(plan)?.body).toMatchObject({
    ordered: [
      { id: categoryId, version: 1 },
      { id: "unchanged", version: 4 },
    ],
    syncCommand: {
      effects: [
        {
          collection: "categories",
          id: categoryId,
          op: "UPSERT",
          baseVersion: 1,
        },
      ],
    },
  });
  expect(
    buildLocalCategoryReplayRequest({
      ...plan,
      mutationIds: [commandId, "missing"],
    }),
  ).toBeNull();
  expect(() =>
    buildLocalCategoryReplayRequest({
      ...plan,
      mutations: [{ ...mutation, operation: "PATCH", baseVersion: 2 }],
    }),
  ).toThrow();
});
