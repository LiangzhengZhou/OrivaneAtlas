import { DatabaseSync } from "node:sqlite";
import { expect, it } from "vitest";
import {
  legacyV21Document,
  legacyV21Session,
} from "../../../tests/contracts/v22-legacy";
import { restoreDatabase } from "./index";
import { inspectSchema, migrate, migrations } from "./migrations";
import { sqliteHarness } from "./testing";

const harness = sqliteHarness();
it("upgrades exact v2.1 SQLite schema27 to v2.2 with legacy message backfill and restorable pre-upgrade backup", async () => {
  const path = harness.file(),
    db = new DatabaseSync(path);
  let backup = "";
  try {
    await migrate(db, path, 100, migrations.slice(0, 27));
    db.exec(
      "INSERT INTO workspace VALUES ('w','W'); INSERT INTO principal VALUES ('p','USER','P'); INSERT INTO workspace_principal VALUES ('w','p')",
    );
    db.prepare(
      "INSERT INTO library_entry VALUES ('w','legacy-document',1,?)",
    ).run(legacyV21Document);
    db.prepare(
      "INSERT INTO agent_session VALUES ('w','legacy-session','p',1,?)",
    ).run(JSON.stringify(legacyV21Session));
    backup = (await migrate(db, path, 100)).backupPath ?? "";
    expect(backup).not.toBe("");
    expect(inspectSchema(db)).toBe(migrations.length);
    expect(
      db
        .prepare("SELECT payload FROM library_entry WHERE id='legacy-document'")
        .get()?.payload,
    ).toBe(legacyV21Document);
    const metadata = db.prepare("SELECT * FROM agent_session_metadata").get()!;
    expect(JSON.parse(String(metadata.summary))).toMatchObject({
      messageCount: 120,
      projectId: null,
      spaceId: null,
      archivedAt: null,
    });
    expect(
      db.prepare("SELECT count(*) n FROM agent_session_message").get()?.n,
    ).toBe(120);
    expect(
      JSON.parse(
        String(
          db
            .prepare(
              "SELECT payload FROM agent_session_message WHERE ordinal=119",
            )
            .get()?.payload,
        ),
      ),
    ).toEqual(legacyV21Session.messages[119]);
    expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  } finally {
    db.close();
  }
  const restoredPath = harness.file();
  await restoreDatabase(backup, restoredPath);
  const restored = new DatabaseSync(restoredPath, { readOnly: true });
  try {
    expect(inspectSchema(restored, migrations.slice(0, 27))).toBe(27);
    expect(
      restored.prepare("SELECT payload FROM agent_session").get()?.payload,
    ).toBe(JSON.stringify(legacyV21Session));
  } finally {
    restored.close();
  }
});
