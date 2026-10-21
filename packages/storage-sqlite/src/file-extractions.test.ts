import { DatabaseSync } from "node:sqlite";
import { expect, it } from "vitest";
import { fileExtractionScenario } from "../../../tests/contracts/file-extraction";
import { restoreDatabase } from "./index";
import { inspectSchema, migrate, migrations } from "./migrations";
import { context, sqliteHarness } from "./testing";

const harness = sqliteHarness();
it("SQLite derived File chunks are scoped, durable and stale-safe without altering originals", async () => {
  const db = await harness.create();
  await fileExtractionScenario((operation) =>
    db.request(
      context,
      null,
      (
        _uow,
        _notes,
        _connected,
        library,
        _organization,
        _projects,
        _sessions,
        files,
        blobs,
      ) => operation(files, library, blobs),
    ),
  );
});

it("upgrades schema37 to extraction and FTS with original bytes preserved and a restorable backup", async () => {
  const file = harness.file(),
    raw = new DatabaseSync(file);
  let backup = "";
  try {
    await migrate(raw, file, 2000, migrations.slice(0, 37));
    raw.exec("INSERT INTO workspace VALUES ('workspace-a','Original')");
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
    backup = (await migrate(raw, file, 2000)).backupPath!;
    expect(inspectSchema(raw)).toBe(42);
    expect(
      raw.prepare("SELECT count(*) count FROM workspace_owner").get()?.count,
    ).toBe(0);
    expect(
      raw.prepare("SELECT bytes FROM file_blob_chunk").get()?.bytes,
    ).toEqual(new Uint8Array([0, 128, 255]));
    expect(
      raw.prepare("SELECT count(*) count FROM file_extraction").get()?.count,
    ).toBe(0);
    expect(
      raw.prepare("SELECT count(*) count FROM file_extraction_fts").get()
        ?.count,
    ).toBe(0);
    expect(raw.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  } finally {
    raw.close();
  }
  const restoredFile = harness.file();
  await restoreDatabase(backup, restoredFile);
  const restored = new DatabaseSync(restoredFile, { readOnly: true });
  try {
    expect(inspectSchema(restored, migrations.slice(0, 37))).toBe(37);
    expect(
      restored.prepare("SELECT bytes FROM file_blob_chunk").get()?.bytes,
    ).toEqual(new Uint8Array([0, 128, 255]));
    expect(
      restored
        .prepare("SELECT name FROM sqlite_schema WHERE name='file_extraction'")
        .all(),
    ).toEqual([]);
  } finally {
    restored.close();
  }
});
