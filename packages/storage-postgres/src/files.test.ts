import { expect, test } from "vitest";
import { fileBinaryContract } from "../../../tests/contracts/file-binary";
import { fileServiceBinaryContract } from "../../../tests/contracts/file-service-binary";
import { fileContract } from "../../../tests/contracts/files";
import { inspectSchema, migrate, migrations } from "./migrations";
import { context, postgresHarness } from "./testing";

const h = postgresHarness();
test("binary completion upgrade preserves v29 chunks and restores its physical backup", async () => {
  const name = await h.database();
  await h.client(name, (client) =>
    migrate(client, 2000, undefined, migrations.slice(0, 29)),
  );
  await h.query(
    name,
    "INSERT INTO arclattice.workspace VALUES('workspace-a','Original')",
  );
  await h.query(
    name,
    "INSERT INTO arclattice.file_blob_descriptor VALUES($1,$2,$3,$4)",
    ["workspace-a", "a".repeat(64), 3, "application/octet-stream"],
  );
  await h.query(
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
  expect(
    await h.client(name, (client) =>
      inspectSchema(client, migrations.slice(0, 29)),
    ),
  ).toBe(29);
  const backup = await h.cluster().snapshot();
  let backupGate = false;
  await h.client(name, (client) =>
    migrate(client, 2000, async () => {
      backupGate = true;
    }),
  );
  expect(backupGate).toBe(true);
  expect(await h.client(name, (client) => inspectSchema(client))).toBe(
    migrations.length,
  );
  expect(
    (
      await h.query(
        name,
        "SELECT chunk_size,completed FROM arclattice.file_blob_descriptor",
      )
    ).rows[0],
  ).toMatchObject({ chunk_size: 262144, completed: false });
  expect(
    (await h.query(name, "SELECT bytes FROM arclattice.file_blob_chunk"))
      .rows[0]?.bytes,
  ).toEqual(Buffer.from([0, 128, 255]));
  await h.cluster().withRestoredSnapshot(backup, async (restored) => {
    expect(
      (
        await restored.query(
          name,
          "SELECT max(version) version FROM arclattice.schema_migrations",
        )
      ).rows[0]?.version,
    ).toBe(29);
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
          "SELECT column_name FROM information_schema.columns WHERE table_schema='arclattice' AND table_name='file_blob_descriptor' ORDER BY ordinal_position",
        )
      ).rows.map((row) => row.column_name),
    ).toEqual(["workspace_id", "content_hash", "size", "mime"]);
  });
}, 180000);
test("File schema upgrades v28 and preserves exact binary chunks", async () => {
  const name = await h.database();
  await h.client(name, (client) =>
    migrate(client, 2000, undefined, migrations.slice(0, 28)),
  );
  await h.query(
    name,
    "INSERT INTO arclattice.workspace VALUES('workspace-a','Preserved')",
  );
  let backupGate = false;
  await h.client(name, (client) =>
    migrate(client, 2000, async () => {
      backupGate = true;
    }),
  );
  expect(backupGate).toBe(true);
  expect(await h.client(name, (client) => inspectSchema(client))).toBe(
    migrations.length,
  );
  expect(
    (await h.query(name, "SELECT name FROM arclattice.workspace")).rows[0]
      ?.name,
  ).toBe("Preserved");
  await h.query(
    name,
    "INSERT INTO arclattice.file_blob_descriptor(workspace_id,content_hash,size,mime) VALUES($1,$2,$3,$4)",
    ["workspace-a", "a".repeat(64), 3, "application/octet-stream"],
  );
  await h.query(
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
  expect(
    (await h.query(name, "SELECT bytes FROM arclattice.file_blob_chunk"))
      .rows[0]?.bytes,
  ).toEqual(Buffer.from([0, 128, 255]));
  await expect(
    h.query(
      name,
      "INSERT INTO arclattice.file_blob_chunk VALUES($1,$2,$3,$4,$5,$6)",
      ["workspace-a", "a".repeat(64), 1, "b".repeat(64), 2, Buffer.from([0])],
    ),
  ).rejects.toThrow();
});
fileContract("PostgreSQL", async () => {
  const name = await h.database();
  const db = await h.provision(await h.open(name));
  return {
    run: (workspaceId, action) =>
      db.knowledge(
        { ...context, workspaceId },
        (_work, _library, _projects, _sessions, _notes, files) => action(files),
      ),
    entity: () =>
      db.run(context.workspaceId, (tx) =>
        tx.workspaceEntity("files", "original-file"),
      ),
    evidence: async () =>
      Promise.all(
        ["file_activity", "file_outbox", "workspace_change"].map(
          async (table) =>
            (
              await h.query(
                name,
                `SELECT * FROM arclattice.${table} ORDER BY 1,2`,
              )
            ).rows,
        ),
      ),
  };
});

fileBinaryContract("PostgreSQL", async () => {
  const db = await h.provision(await h.open(await h.database()));
  return {
    run: (workspaceId, action) =>
      db.knowledge(
        { ...context, workspaceId },
        (_work, _library, _projects, _sessions, _notes, _files, blobs) =>
          action(blobs),
      ),
  };
});

fileServiceBinaryContract("PostgreSQL", async () => {
  const db = await h.provision(await h.open(await h.database()));
  return {
    run: (action) =>
      db.knowledge(
        context,
        (_work, library, _projects, _sessions, _notes, files, blobs) =>
          action(files, library, blobs),
      ),
  };
});
