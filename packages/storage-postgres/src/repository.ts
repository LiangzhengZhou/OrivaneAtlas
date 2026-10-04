import { randomUUID } from "node:crypto";
import type { Organization, WorkTransaction } from "@arclattice/application";
import {
  DomainError,
  defaultNavigationPreference,
  normalizeNavigationPreference,
  type WorkItem,
} from "@arclattice/domain";
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
import { purgeRelations } from "./purge";
import { workflowPort } from "./workflows";
import { workspaceChangePort } from "./workspace-changes";

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
      for (const [position, id] of (item.projectIds ?? []).entries())
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
    ...workspaceChangePort(client, workspaceId, schedule),
    reminders: () =>
      schedule(async () => {
        const result = await client.query(
          "SELECT payload FROM arclattice.reminder WHERE workspace_id=$1 ORDER BY day,id",
          [workspaceId],
        );
        return result.rows.map(
          (row) => row.payload as import("@arclattice/domain").Reminder,
        );
      }),
    saveReminder: (value, expected) =>
      schedule(async () => {
        scope(value);
        await member(value.updatedBy);
        if (value.version !== expected + 1)
          throw new DomainError("VERSION_CONFLICT");
        const payload = JSON.stringify(value);
        const result =
          expected === 0
            ? await client.query(
                "INSERT INTO arclattice.reminder VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING",
                [workspaceId, value.id, value.version, value.day, payload],
              )
            : await client.query(
                "UPDATE arclattice.reminder SET version=$1,day=$2,payload=$3 WHERE workspace_id=$4 AND id=$5 AND version=$6",
                [
                  value.version,
                  value.day,
                  payload,
                  workspaceId,
                  value.id,
                  expected,
                ],
              );
        if (result.rowCount !== 1) throw new DomainError("VERSION_CONFLICT");
        const id = randomUUID();
        await client.query(
          "INSERT INTO arclattice.reminder_activity VALUES ($1,$2,$3)",
          [workspaceId, id, payload],
        );
        await client.query(
          "INSERT INTO arclattice.reminder_outbox VALUES ($1,$2,'REMINDER_CHANGED')",
          [workspaceId, id],
        );
      }),
    organizations: () =>
      schedule(async () => {
        const result = await client.query(
          "SELECT payload FROM arclattice.organization WHERE workspace_id=$1 ORDER BY kind,id",
          [workspaceId],
        );
        return result.rows.map(
          (row) => JSON.parse(String(row.payload)) as Organization,
        );
      }),
    saveOrganization: (value, expected) =>
      schedule(async () => {
        scope(value);
        await member(value.updatedBy);
        if (value.version !== expected + 1)
          throw new DomainError("VERSION_CONFLICT");
        const result =
          expected === 0
            ? await client.query(
                "INSERT INTO arclattice.organization VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING",
                [
                  workspaceId,
                  value.kind,
                  value.id,
                  value.version,
                  JSON.stringify(value),
                ],
              )
            : await client.query(
                "UPDATE arclattice.organization SET version=$1,payload=$2 WHERE workspace_id=$3 AND kind=$4 AND id=$5 AND version=$6",
                [
                  value.version,
                  JSON.stringify(value),
                  workspaceId,
                  value.kind,
                  value.id,
                  expected,
                ],
              );
        if (result.rowCount !== 1) throw new DomainError("VERSION_CONFLICT");
        const id = randomUUID();
        await client.query(
          "INSERT INTO arclattice.organization_activity VALUES ($1,$2,$3)",
          [workspaceId, id, JSON.stringify(value)],
        );
        await client.query(
          "INSERT INTO arclattice.organization_outbox VALUES ($1,$2,'ORGANIZATION_CHANGED')",
          [workspaceId, id],
        );
      }),
    navigationPreference: (principalId) =>
      schedule(async () => {
        const row = (
          await client.query(
            "SELECT preference_json FROM arclattice.user_navigation WHERE workspace_id=$1 AND principal_id=$2",
            [workspaceId, principalId],
          )
        ).rows[0];
        return normalizeNavigationPreference(
          row?.preference_json ?? defaultNavigationPreference(),
        );
      }),
    saveNavigationPreference: (principalId, preference, expected) =>
      schedule(async () => {
        if (preference.version !== expected + 1)
          throw new DomainError("VERSION_CONFLICT");
        const result =
          expected === 0
            ? await client.query(
                "INSERT INTO arclattice.user_navigation VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING",
                [
                  workspaceId,
                  principalId,
                  preference.version,
                  JSON.stringify(preference),
                ],
              )
            : await client.query(
                "UPDATE arclattice.user_navigation SET version=$1,preference_json=$2 WHERE workspace_id=$3 AND principal_id=$4 AND version=$5",
                [
                  preference.version,
                  JSON.stringify(preference),
                  workspaceId,
                  principalId,
                  expected,
                ],
              );
        if (result.rowCount !== 1) throw new DomainError("VERSION_CONFLICT");
      }),
    calendarSettings: () =>
      schedule(async () => {
        const row = (
          await client.query(
            "SELECT version::float8 AS version,timezone FROM arclattice.workspace_calendar WHERE workspace_id=$1",
            [workspaceId],
          )
        ).rows[0];
        return row ?? { version: 0, timezone: null };
      }),
    saveCalendarSettings: (settings, expected) =>
      schedule(async () => {
        if (settings.version !== expected + 1)
          throw new DomainError("VERSION_CONFLICT");
        const result =
          expected === 0
            ? await client.query(
                "INSERT INTO arclattice.workspace_calendar (workspace_id,version,timezone) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING",
                [workspaceId, settings.version, settings.timezone],
              )
            : await client.query(
                "UPDATE arclattice.workspace_calendar SET version=$1,timezone=$2 WHERE workspace_id=$3 AND version=$4",
                [settings.version, settings.timezone, workspaceId, expected],
              );
        if (result.rowCount !== 1) throw new DomainError("VERSION_CONFLICT");
      }),
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
    purge: (id, expected) =>
      schedule(async () => {
        const old = await get(id);
        if (old.version !== expected) throw new DomainError("VERSION_CONFLICT");
        if (!old.deletedAt) throw new DomainError("VALIDATION_ERROR");
        await purgeRelations(client, workspaceId, { kind: "WORK", id });
        await client.query(
          "DELETE FROM arclattice.work_edge WHERE workspace_id=$1 AND (from_id=$2 OR to_id=$2)",
          [workspaceId, id],
        );
        await client.query(
          "DELETE FROM arclattice.task_project WHERE workspace_id=$1 AND (task_id=$2 OR project_id=$2)",
          [workspaceId, id],
        );
        if (
          (
            await client.query(
              "DELETE FROM arclattice.work_item WHERE workspace_id=$1 AND id=$2 AND version=$3 AND deleted_at IS NOT NULL",
              [workspaceId, id, expected],
            )
          ).rowCount !== 1
        )
          throw new DomainError("VERSION_CONFLICT");
      }),
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
      const copy = {
        ...event,
        fromId: event.fromId ?? null,
        toId: event.toId ?? null,
        edgeType: event.edgeType ?? null,
        reason: event.reason ?? null,
      };
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
