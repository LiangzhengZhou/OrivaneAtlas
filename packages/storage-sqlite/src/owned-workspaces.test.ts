import { DatabaseSync } from "node:sqlite";
import { expect, it } from "vitest";
import { migrate, migrations } from "./migrations";
import { ownedWorkspaceDirectory } from "./owned-workspaces";
import { sqliteHarness } from "./testing";

const h = sqliteHarness();
const actor = { workspaceId: "source", principalId: "owner" };
const input = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "New sync workspace",
  activityId: "22222222-2222-4222-8222-222222222222",
  createdAt: "2026-10-15T00:00:00.000Z",
};
it("owned workspace creation and event/outbox rollback together and membership never grants ownership", async () => {
  const path = h.file(),
    db = new DatabaseSync(path);
  try {
    await migrate(db, path, 100);
    db.exec(
      "INSERT INTO workspace VALUES ('source','Source'); INSERT INTO principal VALUES ('owner','USER','Owner'),('other','USER','Other'); INSERT INTO workspace_principal VALUES ('source','owner'),('source','other');",
    );
    const directory = ownedWorkspaceDirectory(db, actor, () => {});
    db.exec("BEGIN IMMEDIATE");
    expect(directory.create(input)).toMatchObject({
      id: input.id,
      ownerPrincipalId: "owner",
      version: 1,
    });
    db.exec("COMMIT");
    expect(directory.list()).toHaveLength(1);
    expect(
      ownedWorkspaceDirectory(
        db,
        { ...actor, principalId: "other" },
        () => {},
      ).list(),
    ).toEqual([]);
    expect(
      db
        .prepare(
          "SELECT count(*) n FROM connected_activity WHERE type='WORKSPACE_CREATED'",
        )
        .get()?.n,
    ).toBe(1);
    expect(
      db
        .prepare(
          "SELECT count(*) n FROM connected_outbox WHERE type='WORKSPACE_CREATED'",
        )
        .get()?.n,
    ).toBe(1);
    db.exec(
      "CREATE TEMP TRIGGER fail_workspace_outbox BEFORE INSERT ON connected_outbox WHEN NEW.workspace_id='33333333-3333-4333-8333-333333333333' BEGIN SELECT RAISE(ABORT,'TEST_OUTBOX_FAILURE'); END;",
    );
    db.exec("BEGIN IMMEDIATE");
    expect(() =>
      directory.create({
        ...input,
        id: "33333333-3333-4333-8333-333333333333",
      }),
    ).toThrow("TEST_OUTBOX_FAILURE");
    db.exec("ROLLBACK");
    expect(
      db
        .prepare(
          "SELECT 1 FROM workspace WHERE id='33333333-3333-4333-8333-333333333333'",
        )
        .get(),
    ).toBeUndefined();
    expect(directory.list()).toHaveLength(1);
  } finally {
    db.close();
  }
});
it("v39 upgrade backfills existing account ownership without changing the original workspace", async () => {
  const path = h.file(),
    db = new DatabaseSync(path);
  try {
    await migrate(db, path, 100, migrations.slice(0, 39));
    db.exec(
      "INSERT INTO workspace VALUES ('source','Original'); INSERT INTO principal VALUES ('owner','USER','Owner'); INSERT INTO workspace_principal VALUES ('source','owner'); INSERT INTO account(id,username,verifier,workspace_id,principal_id,role,status,version,created_at) VALUES ('account','owner','test-only','source','owner','ADMIN','ACTIVE',1,'2026-10-14');",
    );
    const result = await migrate(db, path, 100);
    expect(result.backupPath).toBeTruthy();
    expect(db.prepare("SELECT * FROM workspace_owner").all()).toMatchObject([
      { workspace_id: "source", principal_id: "owner", version: 1 },
    ]);
    expect(
      db.prepare("SELECT name FROM workspace WHERE id='source'").get()?.name,
    ).toBe("Original");
    expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  } finally {
    db.close();
  }
});
