import { expect, it } from "vitest";
import {
  entityMemoLargeVersionScenario,
  entityMemoScenario,
} from "../../../tests/contracts/entity-memos";
import { PostgresUnitOfWork } from "./index";
import { postgresHarness } from "./testing";

const harness = postgresHarness();
it("PostgreSQL retains exact Memo versions through the safe-integer boundary", async () => {
  const name = await harness.database();
  const db = await harness.provision(await harness.open(name));
  const state = await entityMemoLargeVersionScenario(
    (actor, operation) =>
      db.knowledge(
        actor,
        (
          work,
          _library,
          _projects,
          _sessions,
          _notes,
          _files,
          _blobs,
          _connected,
          memos,
        ) => operation(memos, work),
      ),
    async (id, version) => {
      await harness.query(
        name,
        "UPDATE arclattice.entity_memo SET version=$1::bigint,payload=jsonb_set(payload::jsonb,'{version}',to_jsonb($1::bigint))::text WHERE workspace_id=$2 AND id=$3",
        [version, "workspace-a", id],
      );
    },
  );
  await db.close();
  const backup = await harness.cluster().snapshot();
  await harness.cluster().withRestoredSnapshot(backup, async (cluster) => {
    const restored = await PostgresUnitOfWork.open({
      connection: { ...cluster.connection, database: name },
    });
    try {
      await restored.knowledge(
        state.actor,
        async (
          work,
          _library,
          _projects,
          _sessions,
          _notes,
          _files,
          _blobs,
          _connected,
          memos,
        ) => {
          expect(
            await memos.find(state.actor.principalId, state.input),
          ).toEqual(state.memo);
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
    } finally {
      await restored.close();
    }
  });
}, 180000);
it("PostgreSQL private EntityMemo CAS, lifecycle, isolation and atomic Outbox", async () => {
  const name = await harness.database();
  const db = await harness.provision(await harness.open(name));
  await db.provisionWorkspace({ id: "workspace-a", name: "workspace-a" }, [
    { id: "other", kind: "USER", displayName: "Other" },
  ]);
  await entityMemoScenario(
    (actor, operation) =>
      db.knowledge(
        actor,
        (
          work,
          _library,
          _projects,
          _sessions,
          _notes,
          _files,
          _blobs,
          _connected,
          memos,
        ) => operation(memos, work),
      ),
    async () => {
      const counts = (
        await harness.query(
          name,
          "SELECT (SELECT count(*)::int FROM arclattice.entity_memo) rows,(SELECT count(*)::int FROM arclattice.entity_memo_outbox) outbox",
        )
      ).rows[0]!;
      const activities = (
        await harness.query(
          name,
          "SELECT payload FROM arclattice.entity_memo_activity ORDER BY id",
        )
      ).rows.map((row) => String(row.payload));
      return {
        rows: counts.rows as number,
        outbox: counts.outbox as number,
        activities,
      };
    },
  );
}, 30000);
