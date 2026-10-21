import { DatabaseSync } from "node:sqlite";
import { expect, test } from "vitest";
import { fileBinaryContract } from "../../../tests/contracts/file-binary";
import { fileServiceBinaryContract } from "../../../tests/contracts/file-service-binary";
import { fileContract } from "../../../tests/contracts/files";
import { restoreDatabase } from "./index";
import { inspectSchema, migrate, migrations } from "./migrations";
import { context, principal, sqliteHarness } from "./testing";

const h = sqliteHarness();
test("binary completion upgrade preserves v35 chunks as incomplete and restores the exact old backup", async () => {
  const path = h.file(),
    raw = new DatabaseSync(path);
  let backup = "";
  try {
    await migrate(raw, path, 2000, migrations.slice(0, 35));
    raw.exec("INSERT INTO workspace VALUES('workspace-a','Original')");
    raw
      .prepare("INSERT INTO file_blob_descriptor VALUES(?,?,?,?)")
      .run("workspace-a", "a".repeat(64), 3, "application/octet-stream");
    raw
      .prepare("INSERT INTO file_blob_chunk VALUES(?,?,?,?,?,?)")
      .run(
        "workspace-a",
        "a".repeat(64),
        0,
        "b".repeat(64),
        3,
        new Uint8Array([0, 128, 255]),
      );
    expect(inspectSchema(raw, migrations.slice(0, 35))).toBe(35);
    backup = (await migrate(raw, path, 2000)).backupPath!;
    expect(inspectSchema(raw)).toBe(42);
    expect(
      raw
        .prepare("SELECT chunk_size,completed FROM file_blob_descriptor")
        .get(),
    ).toMatchObject({ chunk_size: 262144, completed: 0 });
    expect(
      raw.prepare("SELECT bytes FROM file_blob_chunk").get()?.bytes,
    ).toEqual(new Uint8Array([0, 128, 255]));
  } finally {
    raw.close();
  }
  const restoredPath = h.file();
  await restoreDatabase(backup, restoredPath);
  const restored = new DatabaseSync(restoredPath, { readOnly: true });
  try {
    expect(inspectSchema(restored, migrations.slice(0, 35))).toBe(35);
    expect(
      restored.prepare("SELECT bytes FROM file_blob_chunk").get()?.bytes,
    ).toEqual(new Uint8Array([0, 128, 255]));
    expect(
      restored
        .prepare("PRAGMA table_info(file_blob_descriptor)")
        .all()
        .map((row) => row.name),
    ).toEqual(["workspace_id", "content_hash", "size", "mime"]);
  } finally {
    restored.close();
  }
});
test("File schema upgrades v34 without changing data and restores its pre-upgrade backup", async () => {
  const path = h.file();
  const raw = new DatabaseSync(path);
  let backup = "";
  try {
    await migrate(raw, path, 2000, migrations.slice(0, 34));
    raw.exec("INSERT INTO workspace VALUES('workspace-a','Preserved')");
    backup = (await migrate(raw, path, 2000)).backupPath!;
    expect(inspectSchema(raw)).toBe(42);
    expect(raw.prepare("SELECT name FROM workspace").get()?.name).toBe(
      "Preserved",
    );
    raw
      .prepare(
        "INSERT INTO file_blob_descriptor(workspace_id,content_hash,size,mime) VALUES(?,?,?,?)",
      )
      .run("workspace-a", "a".repeat(64), 3, "application/octet-stream");
    raw
      .prepare("INSERT INTO file_blob_chunk VALUES(?,?,?,?,?,?)")
      .run(
        "workspace-a",
        "a".repeat(64),
        0,
        "b".repeat(64),
        3,
        new Uint8Array([0, 128, 255]),
      );
    expect(
      raw.prepare("SELECT bytes FROM file_blob_chunk").get()?.bytes,
    ).toEqual(new Uint8Array([0, 128, 255]));
    expect(() =>
      raw
        .prepare("INSERT INTO file_blob_chunk VALUES(?,?,?,?,?,?)")
        .run(
          "workspace-a",
          "a".repeat(64),
          1,
          "b".repeat(64),
          2,
          new Uint8Array([0]),
        ),
    ).toThrow();
    expect(raw.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  } finally {
    raw.close();
  }
  const restoredPath = h.file();
  await restoreDatabase(backup, restoredPath);
  const restored = new DatabaseSync(restoredPath, { readOnly: true });
  try {
    expect(inspectSchema(restored, migrations.slice(0, 34))).toBe(34);
    expect(restored.prepare("SELECT name FROM workspace").get()?.name).toBe(
      "Preserved",
    );
    expect(
      restored
        .prepare("SELECT name FROM sqlite_schema WHERE name='library_file'")
        .all(),
    ).toEqual([]);
  } finally {
    restored.close();
  }
});
fileContract("SQLite", async () => {
  const path = h.file();
  const db = await h.open(path);
  for (const id of ["workspace-a", "workspace-b"])
    await db.provisionWorkspace({ id, name: id }, [principal]);
  return {
    run: (workspaceId, action) =>
      db.request(
        { ...context, workspaceId },
        null,
        (
          _work,
          _notes,
          _connected,
          _library,
          _org,
          _projects,
          _sessions,
          files,
        ) => action(files),
      ),
    entity: () =>
      db.run(context.workspaceId, (tx) =>
        tx.workspaceEntity("files", "original-file"),
      ),
    evidence: async () => {
      const raw = new DatabaseSync(path, { readOnly: true });
      try {
        return ["file_activity", "file_outbox", "workspace_change"].map(
          (table) => raw.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all(),
        );
      } finally {
        raw.close();
      }
    },
  };
});

fileBinaryContract("SQLite", async () => {
  const db = await h.open(h.file());
  for (const id of ["workspace-a", "workspace-b"])
    await db.provisionWorkspace({ id, name: id }, [principal]);
  return {
    run: (workspaceId, action) =>
      db.request(
        { ...context, workspaceId },
        null,
        (
          _work,
          _notes,
          _connected,
          _library,
          _organization,
          _projects,
          _sessions,
          _files,
          blobs,
        ) => action(blobs),
      ),
  };
});

fileServiceBinaryContract("SQLite", async () => {
  const db = await h.create();
  return {
    run: (action) =>
      db.request(
        context,
        null,
        (
          _work,
          _notes,
          _connected,
          library,
          _org,
          _projects,
          _sessions,
          files,
          blobs,
        ) => action(files, library, blobs),
      ),
  };
});
