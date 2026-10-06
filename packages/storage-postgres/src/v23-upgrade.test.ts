import { stat } from "node:fs/promises";
import { expect, it } from "vitest";
import { legacyV21Document } from "../../../tests/contracts/v22-legacy";
import { inspectSchema, migrate, migrations } from "./migrations";
import { postgresHarness } from "./testing";

const harness = postgresHarness();
it("upgrades exact v2.2 PostgreSQL schema26 with a Wiki gate and restores its physical backup", async () => {
  const name = await harness.database();
  await harness.client(name, (client) =>
    migrate(client, 2000, undefined, migrations.slice(0, 26)),
  );
  await harness.query(
    name,
    "INSERT INTO arclattice.workspace VALUES ('w','W'); INSERT INTO arclattice.principal VALUES ('p','USER','P'); INSERT INTO arclattice.workspace_principal VALUES ('w','p')",
  );
  await harness.query(
    name,
    "INSERT INTO arclattice.library_entry VALUES ('w','legacy-document',1,$1)",
    [legacyV21Document],
  );
  const backup = await harness.cluster().snapshot();
  await harness.client(name, (client) =>
    migrate(client, 2000, async () => {
      expect((await stat(backup)).isDirectory()).toBe(true);
    }),
  );
  expect(await harness.client(name, (client) => inspectSchema(client))).toBe(
    27,
  );
  expect(
    (
      await harness.query(
        name,
        "SELECT * FROM arclattice.wiki_index_state WHERE workspace_id='w'",
      )
    ).rows[0],
  ).toMatchObject({ index_version: 0, dirty: 1 });
  expect(
    (
      await harness.query(
        name,
        "SELECT payload FROM arclattice.library_entry WHERE id='legacy-document'",
      )
    ).rows[0]?.payload,
  ).toBe(legacyV21Document);
  await harness.cluster().withRestoredSnapshot(backup, async (restored) => {
    expect(
      (
        await restored.query(
          name,
          "SELECT max(version) version FROM arclattice.schema_migrations",
        )
      ).rows[0]?.version,
    ).toBe(26);
    expect(
      (
        await restored.query(
          name,
          "SELECT payload FROM arclattice.library_entry WHERE id='legacy-document'",
        )
      ).rows[0]?.payload,
    ).toBe(legacyV21Document);
  });
}, 180000);
