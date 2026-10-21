import { expect, it } from "vitest";
import { stableConnectedScenario } from "../../../tests/contracts/stable-connected";
import { postgresHarness } from "./testing";

const harness = postgresHarness();
it("PostgreSQL connected transactions preserve stable/deleted identities, rollback and actor scope", async () => {
  const name = await harness.database(),
    db = await harness.provision(await harness.open(name));
  await stableConnectedScenario((actor, operation) =>
    db.knowledge(
      actor,
      (
        uow,
        _library,
        _projects,
        _sessions,
        _notes,
        _files,
        _blobs,
        connected,
      ) => operation(uow, connected),
    ),
  );
  for (const table of ["connected_activity", "connected_outbox"])
    expect(
      (
        await harness.query(
          name,
          `SELECT count(*)::int n FROM arclattice.${table}`,
        )
      ).rows[0]?.n,
    ).toBe(3);
}, 30000);
it("PostgreSQL connected entity, Activity/Outbox and receipt roll back together", async () => {
  const name = await harness.database(),
    db = await harness.provision(await harness.open(name));
  await expect(
    db.knowledge(
      { workspaceId: "workspace-a", principalId: "human" },
      async (
        _uow,
        _library,
        _projects,
        _sessions,
        _notes,
        _files,
        _blobs,
        connected,
      ) => {
        await connected.saveLink(
          {
            id: "rollback",
            workspaceId: "workspace-a",
            version: 1,
            createdBy: "human",
            updatedBy: "human",
            createdAt: "2026-10-14T00:00:00Z",
            updatedAt: "2026-10-14T00:00:00Z",
            deletedAt: null,
            from: { kind: "WORK", id: "a" },
            to: { kind: "WORK", id: "b" },
            relation: "RELATED",
          },
          0,
        );
        throw new Error("ROLLBACK_CONNECTED_RECEIPT");
      },
      { key: "rollback-connected", digest: "original" },
    ),
  ).rejects.toThrow("ROLLBACK_CONNECTED_RECEIPT");
  await db.knowledge(
    { workspaceId: "workspace-a", principalId: "human" },
    async (
      _uow,
      _library,
      _projects,
      _sessions,
      _notes,
      _files,
      _blobs,
      connected,
    ) => {
      expect(await connected.links()).toEqual([]);
    },
  );
  for (const table of [
    "knowledge_link",
    "connected_activity",
    "connected_outbox",
    "request_receipt",
  ])
    expect(
      (
        await harness.query(
          name,
          `SELECT count(*)::int n FROM arclattice.${table}`,
        )
      ).rows[0]?.n,
    ).toBe(0);
}, 30000);
