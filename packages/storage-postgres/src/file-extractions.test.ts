import { expect, it } from "vitest";
import { fileExtractionScenario } from "../../../tests/contracts/file-extraction";
import { inspectSchema, migrate, migrations } from "./migrations";
import { context, postgresHarness } from "./testing";

const harness = postgresHarness();
it("PostgreSQL derived File chunks are scoped, durable and stale-safe without altering originals", async () => {
  const name = await harness.database(),
    db = await harness.provision(await harness.open(name));
  await fileExtractionScenario((operation) =>
    db.knowledge(
      context,
      (_uow, library, _projects, _sessions, _notes, files, blobs) =>
        operation(files, library, blobs),
    ),
  );
}, 30000);

it("upgrades schema32 to extraction/search and restores its physical original-byte backup", async () => {
  const name = await harness.database();
  await harness.client(name, (client) =>
    migrate(client, 2000, undefined, migrations.slice(0, 32)),
  );
  await harness.query(
    name,
    "INSERT INTO arclattice.workspace VALUES ('workspace-a','Original')",
  );
  await harness.query(
    name,
    "INSERT INTO arclattice.file_blob_descriptor(workspace_id,content_hash,size,mime) VALUES($1,$2,$3,$4)",
    ["workspace-a", "a".repeat(64), 3, "application/octet-stream"],
  );
  await harness.query(
    name,
    "INSERT INTO arclattice.file_blob_chunk VALUES($1,$2,$3,$4,$5,$6)",
    [
      "workspace-a",
      "a".repeat(64),
      0,
      "b".repeat(64),
      3,
      Buffer.from([0, 128, 255]),
    ],
  );
  const backup = await harness.cluster().snapshot();
  let backupVerified = false;
  await harness.client(name, (client) =>
    migrate(client, 2000, async () => {
      backupVerified = true;
    }),
  );
  expect(backupVerified).toBe(true);
  expect(await harness.client(name, (client) => inspectSchema(client))).toBe(
    37,
  );
  expect(
    (
      await harness.query(
        name,
        "SELECT count(*) count FROM arclattice.workspace_owner",
      )
    ).rows[0]?.count,
  ).toBe("0");
  expect(
    (await harness.query(name, "SELECT bytes FROM arclattice.file_blob_chunk"))
      .rows[0]?.bytes,
  ).toEqual(Buffer.from([0, 128, 255]));
  expect(
    (
      await harness.query(
        name,
        "SELECT count(*) count FROM arclattice.file_extraction",
      )
    ).rows[0]?.count,
  ).toBe("0");
  await harness.cluster().withRestoredSnapshot(backup, async (restored) => {
    expect(
      (
        await restored.query(
          name,
          "SELECT max(version) version FROM arclattice.schema_migrations",
        )
      ).rows[0]?.version,
    ).toBe(32);
    expect(
      (
        await restored.query(
          name,
          "SELECT bytes FROM arclattice.file_blob_chunk",
        )
      ).rows[0]?.bytes,
    ).toEqual(Buffer.from([0, 128, 255]));
    expect(
      (
        await restored.query(
          name,
          "SELECT to_regclass('arclattice.file_extraction') table_name",
        )
      ).rows[0]?.table_name,
    ).toBeNull();
  });
}, 180000);
