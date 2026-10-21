import { expect, it } from "vitest";
import { inspectSchema, migrate, migrations } from "./migrations";
import { postgresHarness } from "./testing";

const harness = postgresHarness();
it("PostgreSQL connected runtime upgrades v31 without rewriting links and restores the physical pre-upgrade backup", async () => {
  const name = await harness.database();
  await harness.client(name, (client) =>
    migrate(client, 2000, undefined, migrations.slice(0, 31)),
  );
  await harness.query(
    name,
    "INSERT INTO arclattice.workspace VALUES('legacy','Legacy')",
  );
  const payload = JSON.stringify({
    id: "old-link",
    workspaceId: "legacy",
    version: 1,
    from: { kind: "WORK", id: "a" },
    to: { kind: "WORK", id: "b" },
    relation: "REFERENCES",
    createdBy: "owner",
    updatedBy: "owner",
    createdAt: "2026-10-13T00:00:00Z",
    updatedAt: "2026-10-13T00:00:00Z",
    deletedAt: null,
  });
  await harness.query(
    name,
    "INSERT INTO arclattice.knowledge_link(workspace_id,id,version,payload) VALUES('legacy','old-link',1,$1)",
    [payload],
  );
  const before = (
    await harness.query(name, "SELECT * FROM arclattice.knowledge_link")
  ).rows;
  const backup = await harness.cluster().snapshot();
  let backupGate = false;
  await harness.client(name, (client) =>
    migrate(client, 2000, async () => {
      backupGate = true;
    }),
  );
  expect(backupGate).toBe(true);
  expect(await harness.client(name, (client) => inspectSchema(client))).toBe(
    migrations.length,
  );
  expect(
    (await harness.query(name, "SELECT * FROM arclattice.knowledge_link")).rows,
  ).toEqual(before);
  for (const table of ["agent_run", "connected_activity", "connected_outbox"])
    expect(
      (
        await harness.query(
          name,
          `SELECT count(*)::int n FROM arclattice.${table}`,
        )
      ).rows[0]?.n,
    ).toBe(0);
  await harness.cluster().withRestoredSnapshot(backup, async (restored) => {
    expect(
      (
        await restored.query(
          name,
          "SELECT max(version)::int version FROM arclattice.schema_migrations",
        )
      ).rows[0]?.version,
    ).toBe(31);
    expect(
      (await restored.query(name, "SELECT * FROM arclattice.knowledge_link"))
        .rows,
    ).toEqual(before);
    expect(
      (
        await restored.query(
          name,
          "SELECT to_regclass('arclattice.connected_activity') name",
        )
      ).rows[0]?.name,
    ).toBeNull();
  });
  expect(await harness.client(name, (client) => inspectSchema(client))).toBe(
    migrations.length,
  );
}, 180000);
