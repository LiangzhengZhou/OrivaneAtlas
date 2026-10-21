import { DatabaseSync } from "node:sqlite";
import { expect, it } from "vitest";
import {
  entityMemoLargeVersionScenario,
  entityMemoScenario,
} from "../../../tests/contracts/entity-memos";
import { restoreDatabase } from "./index";
import { sqliteHarness } from "./testing";

const harness = sqliteHarness();
it("SQLite retains exact Memo versions through the safe-integer boundary", async () => {
  const db = await harness.create();
  const state = await entityMemoLargeVersionScenario(
    (actor, operation) =>
      db.request(
        actor,
        null,
        (
          work,
          _notes,
          _connected,
          _library,
          _organization,
          _projects,
          _sessions,
          _files,
          _blobs,
          memos,
        ) => operation(memos, work),
      ),
    async (id, version) => {
      const writer = new DatabaseSync(db.filename);
      try {
        writer
          .prepare(
            "UPDATE entity_memo SET version=?,payload=json_set(payload,'$.version',?) WHERE workspace_id=? AND id=?",
          )
          .run(version, version, "workspace-a", id);
      } finally {
        writer.close();
      }
    },
  );
  const backup = harness.file();
  await db.backup(backup);
  const destination = harness.file();
  await restoreDatabase(backup, destination);
  const restored = await harness.open(destination);
  await restored.request(
    state.actor,
    null,
    async (
      work,
      _notes,
      _connected,
      _library,
      _organization,
      _projects,
      _sessions,
      _files,
      _blobs,
      memos,
    ) => {
      expect(await memos.find(state.actor.principalId, state.input)).toEqual(
        state.memo,
      );
      await work.run(state.actor.workspaceId, async (tx) => {
        expect(
          await tx.workspaceEntity("entityMemos", state.memo!.id),
        ).toBeNull();
        expect(
          await tx.workspaceEntity(
            "entityMemos",
            state.memo!.id,
            state.actor.principalId,
          ),
        ).toEqual(state.memo);
      });
    },
  );
});
it("SQLite private EntityMemo CAS, lifecycle, isolation and atomic Outbox", async () => {
  const db = await harness.create();
  await db.provisionWorkspace({ id: "workspace-a", name: "workspace-a" }, [
    { id: "other", kind: "USER", displayName: "Other" },
  ]);
  await entityMemoScenario(
    (actor, operation) =>
      db.request(
        actor,
        null,
        (
          work,
          _notes,
          _connected,
          _library,
          _organization,
          _projects,
          _sessions,
          _files,
          _blobs,
          memos,
        ) => operation(memos, work),
      ),
    async () => {
      const reader = new DatabaseSync(db.filename, { readOnly: true });
      try {
        return {
          rows: Number(
            reader.prepare("SELECT count(*) n FROM entity_memo").get()!.n,
          ),
          outbox: Number(
            reader.prepare("SELECT count(*) n FROM entity_memo_outbox").get()!
              .n,
          ),
          activities: reader
            .prepare("SELECT payload FROM entity_memo_activity ORDER BY id")
            .all()
            .map((row) => String(row.payload)),
        };
      } finally {
        reader.close();
      }
    },
  );
});
