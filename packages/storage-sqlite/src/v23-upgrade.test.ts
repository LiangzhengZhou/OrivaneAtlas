import { DatabaseSync } from "node:sqlite";
import { expect, it } from "vitest";
import { legacyV21Document } from "../../../tests/contracts/v22-legacy";
import { restoreDatabase } from "./index";
import { inspectSchema, migrate, migrations } from "./migrations";
import { sqliteHarness } from "./testing";

const harness = sqliteHarness();
it("upgrades exact v2.2 SQLite schema32 with a dirty Wiki gate and restorable original bytes", async () => {
  const file = harness.file(),
    raw = new DatabaseSync(file);
  let backup = "";
  try {
    await migrate(raw, file, 100, migrations.slice(0, 32));
    raw.exec(
      "INSERT INTO workspace VALUES ('w','W'); INSERT INTO principal VALUES ('p','USER','P'); INSERT INTO workspace_principal VALUES ('w','p')",
    );
    raw
      .prepare("INSERT INTO library_entry VALUES ('w','legacy-document',1,?)")
      .run(legacyV21Document);
    backup = (await migrate(raw, file, 100)).backupPath ?? "";
    expect(backup).not.toBe("");
    expect(inspectSchema(raw)).toBe(33);
    expect(
      raw
        .prepare("SELECT * FROM wiki_index_state WHERE workspace_id='w'")
        .get(),
    ).toMatchObject({ index_version: 0, dirty: 1 });
    expect(
      raw
        .prepare("SELECT payload FROM library_entry WHERE id='legacy-document'")
        .get()?.payload,
    ).toBe(legacyV21Document);
    expect(raw.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  } finally {
    raw.close();
  }
  const restoredFile = harness.file();
  await restoreDatabase(backup, restoredFile);
  const restored = new DatabaseSync(restoredFile, { readOnly: true });
  try {
    expect(inspectSchema(restored, migrations.slice(0, 32))).toBe(32);
    expect(
      restored
        .prepare("SELECT payload FROM library_entry WHERE id='legacy-document'")
        .get()?.payload,
    ).toBe(legacyV21Document);
  } finally {
    restored.close();
  }
});
