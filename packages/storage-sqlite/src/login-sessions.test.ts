import { createHash, randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { expect, test } from "vitest";
import { snapshotToNewFile } from "./database";
import { restoreDatabase, SqliteUnitOfWork } from "./index";
import { inspectSchema, migrate, migrations } from "./migrations";

test("v11 upgrade preserves accounts and notes; pre-upgrade backup and v12 snapshot restore independently", async () => {
  const dir = mkdtempSync(join(tmpdir(), "atlas-session-migration-"));
  const file = join(dir, "before.sqlite");
  const raw = new DatabaseSync(file);
  let backup = "";
  const snapshot = join(dir, "after.sqlite");
  const body = JSON.stringify({ bodyMd: "个人数据\r\n$E=mc^2$" });
  try {
    await migrate(raw, file, 100, migrations.slice(0, 11));
    raw.exec(
      "INSERT INTO workspace VALUES ('w','Owner'); INSERT INTO principal VALUES ('p','USER','Owner'); INSERT INTO workspace_principal VALUES ('w','p'); INSERT INTO account VALUES ('a','owner','verifier','w','p','ADMIN','ACTIVE',1,'2026-09-17')",
    );
    raw
      .prepare("INSERT INTO notebook VALUES ('w','n',1,'NOTE',NULL,NULL,?)")
      .run(body);
    const history = raw.prepare("SELECT * FROM schema_migrations").all();
    backup = (await migrate(raw, file, 100, migrations.slice(0, 12)))
      .backupPath!;
    expect(inspectSchema(raw, migrations.slice(0, 12))).toBe(12);
    expect(
      raw.prepare("SELECT * FROM schema_migrations WHERE version<=11").all(),
    ).toEqual(history);
    expect(raw.prepare("SELECT payload FROM notebook").get()?.payload).toBe(
      body,
    );
    expect(raw.prepare("SELECT username FROM account").get()?.username).toBe(
      "owner",
    );
    raw
      .prepare("INSERT INTO login_session VALUES ('s',?,'a',1,1,NULL)")
      .run("a".repeat(64));
    await snapshotToNewFile(raw, snapshot);
  } finally {
    raw.close();
  }
  try {
    for (const [source, version] of [
      [backup, 11],
      [snapshot, 12],
    ] as const) {
      const restoredPath = join(dir, `restore-${version}.sqlite`);
      await restoreDatabase(source, restoredPath);
      const restored = new DatabaseSync(restoredPath);
      try {
        expect(inspectSchema(restored, migrations.slice(0, version))).toBe(
          version,
        );
        expect(
          restored.prepare("PRAGMA integrity_check").get()?.integrity_check,
        ).toBe("ok");
        expect(restored.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
        expect(
          restored.prepare("SELECT payload FROM notebook").get()?.payload,
        ).toBe(body);
        if (version === 12) {
          // Recovery must not resurrect sessions revoked after the backup.
          restored.exec("DELETE FROM login_session");
          expect(
            restored.prepare("SELECT count(*) n FROM login_session").get()?.n,
          ).toBe(0);
        }
      } finally {
        restored.close();
      }
    }
  } finally {
    rmSync(dir, { recursive: true });
  }
});

test("session capacity is per account, replacement is atomic, stale issuance rejected", async () => {
  const dir = mkdtempSync(join(tmpdir(), "atlas-session-capacity-"));
  const db = await SqliteUnitOfWork.open(join(dir, "test.sqlite"));
  const hash = () => createHash("sha256").update(randomBytes(32)).digest("hex");
  try {
    const create = (name: string) =>
      db.accounts((s) => {
        const a = s.register(name, "verifier", false);
        return s.status(a.id, a.version, "ACTIVE");
      });
    const a = await create("first"),
      b = await create("second");
    const original = hash();
    for (let i = 0; i < 32; i++)
      await db.accounts((s) =>
        s.createSession(
          a.id,
          a.version,
          i === 0 ? original : hash(),
          null,
          1000,
          "",
        ),
      );
    await expect(
      db.accounts((s) =>
        s.createSession(a.id, a.version, hash(), null, 1000, ""),
      ),
    ).rejects.toThrow("RATE_LIMITED");
    await db.accounts((s) =>
      s.createSession(b.id, b.version, hash(), null, 1000, ""),
    );
    const replacement = hash();
    await db.accounts((s) =>
      s.createSession(a.id, a.version, replacement, null, 1000, original),
    );
    expect(await db.accounts((s) => s.session(original, 1000))).toBeNull();
    expect(
      await db.accounts((s) => s.session(replacement, 1000)),
    ).not.toBeNull();
    expect(await db.accounts((s) => s.sessions(a.id, 1000))).toHaveLength(32);
    await db.accounts((s) => s.password(a.id, "changed-verifier"));
    await expect(
      db.accounts((s) =>
        s.createSession(a.id, a.version, hash(), null, 1000, ""),
      ),
    ).rejects.toThrow("FORBIDDEN");
    expect(await db.accounts((s) => s.sessions(a.id, 1000))).toHaveLength(0);
    expect(await db.accounts((s) => s.sessions(b.id, 1000))).toHaveLength(1);
  } finally {
    await db.close();
    rmSync(dir, { recursive: true });
  }
});
