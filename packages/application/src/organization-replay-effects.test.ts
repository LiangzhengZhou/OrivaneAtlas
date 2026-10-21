import { DomainError } from "@arclattice/domain";
import { expect, it, vi } from "vitest";
import type { Organization, OrganizationStore } from "./organization";
import { OrganizationService } from "./organization";
import {
  OrganizationReplayStore,
  requireCanonicalOrganization,
} from "./organization-replay-effects";

const value: Organization = {
  kind: "WORK",
  id: "task",
  workspaceId: "workspace",
  version: 1,
  archived: true,
  folder: "",
  updatedAt: "2026-10-13T00:00:00Z",
  updatedBy: "owner",
};
function fixture() {
  const rows: Organization[] = [];
  const store: OrganizationStore = {
    list: async () => structuredClone(rows),
    save: async (entry) => {
      rows.push(structuredClone(entry));
    },
  };
  return { store, rows };
}
it("organization guard requires complete declared effects and detaches canonical receipts", async () => {
  const { store, rows } = fixture();
  const guard = new OrganizationReplayStore(store, "workspace", "owner", [
    {
      collection: "organization",
      id: "WORK:task",
      op: "UPSERT",
      baseVersion: 0,
    },
  ]);
  await expect(guard.finish()).rejects.toMatchObject({
    code: "VERSION_CONFLICT",
  });
  await expect(guard.save({ ...value, id: "other" }, 0)).rejects.toMatchObject({
    code: "VERSION_CONFLICT",
  });
  expect(rows).toEqual([]);
  await guard.save(value, 0);
  await expect(guard.save(value, 0)).rejects.toMatchObject({
    code: "VERSION_CONFLICT",
  });
  await guard.finish();
  const receipt = guard.acceptedEffects;
  const first = receipt[0];
  if (!first) throw new Error("MISSING_RECEIPT");
  first.value.archived = false;
  expect(guard.acceptedEffects[0]?.value.archived).toBe(true);
});
it("organization guard refuses foreign principals, invalid canonical keys and stale store versions", async () => {
  const { store, rows } = fixture();
  const guard = new OrganizationReplayStore(store, "workspace", "owner", [
    {
      collection: "organization",
      id: "WORK:task",
      op: "UPSERT",
      baseVersion: 0,
    },
  ]);
  await expect(
    guard.save({ ...value, updatedBy: "foreign" }, 0),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  expect(() =>
    requireCanonicalOrganization(value, "NOTE:task", "workspace", 1),
  ).toThrow(DomainError);
  rows.push(value);
  await expect(guard.save(value, 0)).rejects.toMatchObject({
    code: "VERSION_CONFLICT",
  });
});
it("ordinary organization input is captured before authorization yields and denied access performs no reads", async () => {
  const store = { list: vi.fn(async () => []), save: vi.fn(async () => {}) };
  const work = {
    snapshot: vi.fn(async () => ({
      items: [
        {
          id: "task",
          workspaceId: "workspace",
          version: 1,
          deletedAt: null,
          type: "TASK",
        },
      ],
    })),
  };
  const input = {
    kind: "WORK" as const,
    action: "archive" as const,
    entries: [{ id: "task", version: 1, organizationVersion: 0 }],
  };
  const authorization = {
    require: vi.fn(async () => {
      const first = input.entries[0];
      if (!first) throw new Error("MISSING_INPUT");
      first.id = "mutated";
    }),
  };
  const service = new OrganizationService(
    store,
    work as never,
    {} as never,
    authorization,
    { now: () => value.updatedAt },
  );
  await expect(
    service.apply({ workspaceId: "workspace", principalId: "owner" }, input),
  ).resolves.toEqual({ changed: 1 });
  expect(store.save).toHaveBeenCalledWith(value, 0);
  store.list.mockClear();
  work.snapshot.mockClear();
  authorization.require.mockRejectedValueOnce(new DomainError("FORBIDDEN"));
  await expect(
    service.apply({ workspaceId: "workspace", principalId: "owner" }, input),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  expect(store.list).not.toHaveBeenCalled();
  expect(work.snapshot).not.toHaveBeenCalled();
});
