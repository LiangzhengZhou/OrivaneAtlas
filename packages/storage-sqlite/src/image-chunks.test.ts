import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it, vi } from "vitest";
import { snapshotToNewFile } from "./database";
import { restoreDatabase } from "./index";
import { inspectSchema, migrate, migrations } from "./migrations";
import { context, principal, sqliteHarness } from "./testing";

const harness = sqliteHarness();
const png =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aXs8AAAAASUVORK5CYII=";
const asset = () => ({
  id: randomUUID(),
  spaceId: null,
  name: "paste.png",
  mime: "image/png",
  base64: png,
});
describe("image chunk storage", () => {
  it("isolates upload principals, hides staging and cleans only expired unfinished uploads", async () => {
    const db = await harness.open();
    await db.provisionWorkspace({ id: context.workspaceId, name: "Images" }, [
      principal,
      { ...principal, id: "other" },
    ]);
    const pending = asset(),
      complete = asset();
    const put = (
      value: ReturnType<typeof asset>,
      index: number,
      final: boolean,
      actor = context,
    ) =>
      db.request(actor, null, (_u, _n, _c, s) =>
        s.putAssetChunk(value, index, final),
      );
    await put(pending, 0, false);
    await expect(
      db.request(context, null, (_u, _n, _c, s) => s.asset(pending.id)),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      put(pending, 1, true, { ...context, principalId: "other" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await put(complete, 0, true);
    const time = vi.spyOn(Date, "now").mockReturnValue(Date.now() + 86400001);
    try {
      await put(asset(), 0, true);
    } finally {
      time.mockRestore();
    }
    await expect(put(pending, 1, true)).rejects.toMatchObject({
      code: "VERSION_CONFLICT",
    });
    expect(
      await db.request(context, null, (_u, _n, _c, s) =>
        s.assetChunk(complete.id, 0),
      ),
    ).toBe(png);
    const backup = harness.file();
    await db.backup(backup);
    const raw = new DatabaseSync(backup, { readOnly: true });
    try {
      expect(
        raw
          .prepare(
            "SELECT count(*) n FROM library_asset_chunk WHERE upload_id=?",
          )
          .get(pending.id)?.n,
      ).toBe(0);
      expect(
        raw
          .prepare(
            "SELECT count(*) n FROM connected_activity WHERE entity_id=? AND type='ASSET_UPLOAD_EXPIRED'",
          )
          .get(pending.id)?.n,
      ).toBe(1);
      expect(
        raw.prepare("SELECT count(*) n FROM connected_activity").get()?.n,
      ).toBe(raw.prepare("SELECT count(*) n FROM connected_outbox").get()?.n);
    } finally {
      raw.close();
    }
  });
  it("rejects continuation when a parent space is deleted", async () => {
    const db = await harness.create();
    const space = {
      id: randomUUID(),
      workspaceId: context.workspaceId,
      kind: "SPACE" as const,
      spaceId: null,
      title: "Images",
      bodyMd: "",
      version: 1,
      createdAt: "2026-09-15",
      updatedAt: "2026-09-15",
      createdBy: context.principalId,
      updatedBy: context.principalId,
      deletedAt: null,
      provenance: "HUMAN" as const,
    };
    await db.request(context, null, (_u, _n, _c, s) => s.save(space, 0));
    const image = { ...asset(), spaceId: space.id };
    await db.request(context, null, (_u, _n, _c, s) =>
      s.putAssetChunk(image, 0, false),
    );
    await db.request(context, null, (_u, _n, _c, s) =>
      s.save({ ...space, version: 2, deletedAt: "2026-09-15" }, 1),
    );
    await expect(
      db.request(context, null, (_u, _n, _c, s) =>
        s.putAssetChunk(image, 1, true),
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
  it("upgrades v8 without changing legacy bytes and restores the pre-upgrade snapshot", async () => {
    const path = harness.file(),
      raw = new DatabaseSync(path);
    let before = "";
    const after = harness.file();
    try {
      raw.exec("PRAGMA foreign_keys=ON");
      await migrate(raw, path, 100, migrations.slice(0, 8));
      raw.exec("INSERT INTO workspace VALUES ('w','Images')");
      raw
        .prepare(
          "INSERT INTO library_asset VALUES ('w','old',NULL,'old.png','image/png',?)",
        )
        .run(png);
      before = (await migrate(raw, path, 100)).backupPath!;
      expect(inspectSchema(raw)).toBe(migrations.length);
      expect(
        raw.prepare("SELECT base64 FROM library_asset").get()?.base64,
      ).toBe(png);
      await snapshotToNewFile(raw, after);
    } finally {
      raw.close();
    }
    for (const [source, version] of [
      [before, 8],
      [after, migrations.length],
    ] as const) {
      const destination = harness.file();
      await restoreDatabase(source, destination);
      const restored = new DatabaseSync(destination, { readOnly: true });
      try {
        expect(inspectSchema(restored, migrations.slice(0, version))).toBe(
          version,
        );
        expect(
          restored.prepare("SELECT base64 FROM library_asset").get()?.base64,
        ).toBe(png);
        expect(
          restored.prepare("PRAGMA integrity_check").get()?.integrity_check,
        ).toBe("ok");
        expect(restored.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
      } finally {
        restored.close();
      }
    }
  });
});
