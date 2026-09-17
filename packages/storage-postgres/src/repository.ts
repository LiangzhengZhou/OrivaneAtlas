import type { WorkTransaction } from "@arclattice/application";
import { DomainError, type WorkItem } from "@arclattice/domain";
import type { PoolClient } from "pg";
import { categoryPort } from "./categories";
import { PostgresStorageError, pgCode } from "./database";
import {
  activityFields,
  edgeFields,
  outboxFields,
  projection,
  workFields,
} from "./fields";
import { workflowPort } from "./workflows";

function values<T extends object>(
  fields: Partial<Record<keyof T, string>>,
  entity: T,
) {
  return (Object.keys(fields) as (keyof T)[]).map((key) => entity[key]);
}
async function insert<T extends object>(
  client: PoolClient,
  table: string,
  fields: Partial<Record<keyof T, string>>,
  entity: T,
) {
  await client.query(
    "INSERT INTO arclattice." +
      table +
      " (" +
      Object.values(fields).join(", ") +
      ") VALUES (" +
      Object.keys(fields)
        .map((_, i) => "$" + (i + 1))
        .join(", ") +
      ")",
    values(fields, entity),
  );
}

/** Serializes accepted port calls and seals the handle before releasing a client.
 * A caught port error still poisons the unit, preventing partial commits.
 */
export function repository(client: PoolClient, workspaceId: string) {
  let active = true;
  let tail: Promise<void> = Promise.resolve();
  let failure: { error: unknown } | undefined;
  function schedule<T>(operation: () => Promise<T>): Promise<T> {
    if (!active)
      return Promise.reject(new PostgresStorageError("TRANSACTION_CLOSED"));
    const pending = tail.then(() => {
      if (failure) throw failure.error;
      return operation();
    });
    tail = pending.then(
      () => undefined,
      (error) => {
        failure ??= { error };
      },
    );
    return pending;
  }
  const scope = (entity: { workspaceId: string }) => {
    if (entity.workspaceId !== workspaceId) throw new DomainError("FORBIDDEN");
  };
  const member = async (id: string | null) => {
    if (
      id !== null &&
      !(
        await client.query(
          "SELECT 1 FROM arclattice.workspace_principal WHERE workspace_id=$1 AND principal_id=$2",
          [workspaceId, id],
        )
      ).rowCount
    )
      throw new DomainError("FORBIDDEN");
  };
  const hydrate = async (item: WorkItem): Promise<WorkItem> =>
    item.type !== "TASK"
      ? item
      : {
          ...item,
          projectIds: (
            await client.query(
              "SELECT project_id FROM arclattice.task_project WHERE workspace_id=$1 AND task_id=$2 ORDER BY position",
              [workspaceId, item.id],
            )
          ).rows.map((r) => String(r.project_id)),
        };
  const memberships = async (item: WorkItem) => {
    await client.query(
      "DELETE FROM arclattice.task_project WHERE workspace_id=$1 AND task_id=$2",
      [workspaceId, item.id],
    );
    if (item.type === "TASK")
      for (const [position, id] of (
        item.projectIds ?? (item.projectId ? [item.projectId] : [])
      ).entries())
        await client.query(
          "INSERT INTO arclattice.task_project VALUES ($1,$2,$3,$4)",
          [workspaceId, item.id, id, position],
        );
  };
  const get = async (id: string): Promise<WorkItem> => {
    const row = (
      await client.query(
        "SELECT " +
          projection(workFields) +
          " FROM arclattice.work_item WHERE workspace_id=$1 AND id=$2",
        [workspaceId, id],
      )
    ).rows[0];
    if (!row) throw new DomainError("NOT_FOUND");
    return hydrate(row as WorkItem);
  };
  const hydrateList = async (items: WorkItem[]) => {
    const rows = (
      await client.query(
        "SELECT task_id, project_id FROM arclattice.task_project WHERE workspace_id=$1 ORDER BY position",
        [workspaceId],
      )
    ).rows;
    const byTask = new Map<string, string[]>();
    for (const row of rows) {
      const ids = byTask.get(row.task_id) ?? [];
      ids.push(row.project_id);
      byTask.set(row.task_id, ids);
    }
    return items.map((item) =>
      item.type === "TASK"
        ? { ...item, projectIds: byTask.get(item.id) ?? [] }
        : item,
    );
  };
  const port: WorkTransaction = {
    ...categoryPort(client, workspaceId, schedule),
    ...workflowPort(client, workspaceId, schedule),
    get: (id) => schedule(() => get(id)),
    list: (includeDeleted = false) =>
      schedule(async () =>
        hydrateList(
          (
            await client.query(
              "SELECT " +
                projection(workFields) +
                " FROM arclattice.work_item WHERE workspace_id=$1" +
                (includeDeleted ? "" : " AND deleted_at IS NULL") +
                " ORDER BY created_at, id",
              [workspaceId],
            )
          ).rows,
        ),
      ),
    edges: () =>
      schedule(
        async () =>
          (
            await client.query(
              "SELECT " +
                projection(edgeFields) +
                " FROM arclattice.work_edge WHERE workspace_id=$1 ORDER BY created_at, id",
              [workspaceId],
            )
          ).rows,
      ),
    insert: (item) => {
      const copy = structuredClone(item);
      return schedule(async () => {
        scope(copy);
        await member(copy.createdBy);
        await member(copy.updatedBy);
        await member(copy.assigneePrincipalId);
        if (copy.version !== 1) throw new DomainError("VERSION_CONFLICT");
        try {
          await insert(client, "work_item", workFields, copy);
          await memberships(copy);
        } catch (error) {
          if (pgCode(error) === "23505")
            throw new DomainError("VERSION_CONFLICT");
          throw error;
        }
      });
    },
    replace: (item, expectedVersion) => {
      const copy = structuredClone(item);
      return schedule(async () => {
        scope(copy);
        await member(copy.createdBy);
        await member(copy.updatedBy);
        await member(copy.assigneePrincipalId);
        const old = await get(copy.id);
        if (
          !Number.isSafeInteger(expectedVersion) ||
          old.version !== expectedVersion ||
          copy.version !== expectedVersion + 1
        )
          throw new DomainError("VERSION_CONFLICT", {
            expectedVersion,
            actualVersion: old.version,
          });
        const parameters = values(workFields, copy);
        const count = parameters.length;
        const result = await client.query(
          "UPDATE arclattice.work_item SET " +
            Object.values(workFields)
              .map((field, i) => field + "=$" + (i + 1))
              .join(", ") +
            " WHERE workspace_id=$" +
            (count + 1) +
            " AND id=$" +
            (count + 2) +
            " AND version=$" +
            (count + 3),
          [...parameters, workspaceId, copy.id, expectedVersion],
        );
        if (result.rowCount !== 1) throw new DomainError("VERSION_CONFLICT");
        await memberships(copy);
      });
    },
    addEdge: (edge) => {
      const copy = { ...edge };
      return schedule(async () => {
        scope(copy);
        await member(copy.createdBy);
        if (
          (await get(copy.fromId)).deletedAt ||
          (await get(copy.toId)).deletedAt
        )
          throw new DomainError("NOT_FOUND");
        try {
          await insert(client, "work_edge", edgeFields, copy);
        } catch (error) {
          if (pgCode(error) === "23505")
            throw new DomainError("DUPLICATE_EDGE");
          throw error;
        }
      });
    },
    removeEdge: (id) =>
      schedule(async () => {
        if (
          (
            await client.query(
              "DELETE FROM arclattice.work_edge WHERE workspace_id=$1 AND id=$2",
              [workspaceId, id],
            )
          ).rowCount !== 1
        )
          throw new DomainError("NOT_FOUND");
      }),
    appendActivity: (event) => {
      const copy = { ...event };
      return schedule(async () => {
        scope(copy);
        await member(copy.principalId);
        await insert(client, "activity", activityFields, copy);
      });
    },
    appendOutbox: (event) => {
      const copy = { ...event };
      return schedule(async () => {
        scope(copy);
        await insert(client, "outbox", outboxFields, copy);
      });
    },
  };
  return {
    port,
    async finish() {
      active = false;
      await tail;
      if (failure) throw failure.error;
    },
  };
}
