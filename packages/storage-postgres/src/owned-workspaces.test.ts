import { expect, it } from "vitest";
import { migrate, migrations } from "./migrations";
import { ownedWorkspaceDirectory } from "./owned-workspaces";
import { postgresHarness } from "./testing";

const h = postgresHarness();
const actor = { workspaceId: "source", principalId: "owner" };
const input = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "New sync workspace",
  activityId: "22222222-2222-4222-8222-222222222222",
  createdAt: "2026-10-15T00:00:00.000Z",
};
it("PostgreSQL owns the same workspace/event contract and rollback boundary as SQLite", async () => {
  const name = await h.database();
  await h.client(name, (client) =>
    migrate(client, 2000, undefined, migrations.slice(0, 34)),
  );
  await h.query(
    name,
    "INSERT INTO arclattice.workspace VALUES ('source','Original'); INSERT INTO arclattice.principal VALUES ('owner','USER','Owner'),('other','USER','Other'); INSERT INTO arclattice.workspace_principal VALUES ('source','owner'),('source','other');",
  );
  let backedUp = false;
  await h.client(name, (client) =>
    migrate(client, 2000, async () => {
      backedUp = true;
    }),
  );
  expect(backedUp).toBe(true);
  await h.client(name, async (client) => {
    const directory = ownedWorkspaceDirectory(client, actor, () => {});
    await client.query("BEGIN");
    expect(await directory.create(input)).toEqual({
      id: input.id,
      name: input.name,
      ownerPrincipalId: actor.principalId,
      version: 1,
      createdAt: input.createdAt,
    });
    await client.query("COMMIT");
    expect(await directory.list()).toHaveLength(1);
    expect(
      await ownedWorkspaceDirectory(
        client,
        { ...actor, principalId: "other" },
        () => {},
      ).list(),
    ).toEqual([]);
    expect(
      (
        await client.query(
          "SELECT count(*)::int n FROM arclattice.connected_outbox WHERE type='WORKSPACE_CREATED'",
        )
      ).rows[0].n,
    ).toBe(1);
    await client.query("BEGIN");
    const second = { ...input, id: "33333333-3333-4333-8333-333333333333" };
    await directory.create(second);
    await client.query("ROLLBACK");
    expect(
      (
        await client.query("SELECT 1 FROM arclattice.workspace WHERE id=$1", [
          second.id,
        ])
      ).rowCount,
    ).toBe(0);
    expect(await directory.list()).toHaveLength(1);
    expect(
      (
        await client.query(
          "SELECT name FROM arclattice.workspace WHERE id='source'",
        )
      ).rows[0].name,
    ).toBe("Original");
  });
});
