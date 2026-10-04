import { stat } from "node:fs/promises";
import { expect, it } from "vitest";
import {
  legacyV21Document,
  legacyV21Session,
} from "../../../tests/contracts/v22-legacy";
import { inspectSchema, migrate, migrations } from "./migrations";
import { postgresHarness } from "./testing";

const harness = postgresHarness();
it("upgrades exact v2.1 PostgreSQL schema20 to v2.2 and restores legacy messages from a physical backup", async () => {
  const name = await harness.database();
  await harness.client(name, (client) =>
    migrate(client, 2000, undefined, migrations.slice(0, 20)),
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
  await harness.query(
    name,
    "INSERT INTO arclattice.agent_session VALUES ('w','legacy-session','p',1,$1)",
    [JSON.stringify(legacyV21Session)],
  );
  const backup = await harness.cluster().snapshot();
  await harness.client(name, (client) =>
    migrate(client, 2000, async () => {
      expect((await stat(backup)).isDirectory()).toBe(true);
    }),
  );
  expect(await harness.client(name, (client) => inspectSchema(client))).toBe(
    migrations.length,
  );
  expect(
    (
      await harness.query(
        name,
        "SELECT payload FROM arclattice.library_entry WHERE id='legacy-document'",
      )
    ).rows[0]?.payload,
  ).toBe(legacyV21Document);
  expect(
    (
      await harness.query(
        name,
        "SELECT summary FROM arclattice.agent_session_metadata",
      )
    ).rows[0]?.summary,
  ).toMatchObject({
    messageCount: 120,
    projectId: null,
    spaceId: null,
    archivedAt: null,
  });
  expect(
    (
      await harness.query(
        name,
        "SELECT count(*) n FROM arclattice.agent_session_message",
      )
    ).rows[0]?.n,
  ).toBe("120");
  expect(
    (
      await harness.query(
        name,
        "SELECT payload FROM arclattice.agent_session_message WHERE ordinal=119",
      )
    ).rows[0]?.payload,
  ).toEqual(legacyV21Session.messages[119]);
  await harness.cluster().withRestoredSnapshot(backup, async (restored) => {
    expect(
      (
        await restored.query(
          name,
          "SELECT max(version) version FROM arclattice.schema_migrations",
        )
      ).rows[0]?.version,
    ).toBe(20);
    expect(
      (
        await restored.query(
          name,
          "SELECT payload FROM arclattice.agent_session",
        )
      ).rows[0]?.payload,
    ).toBe(JSON.stringify(legacyV21Session));
  });
}, 180000);
