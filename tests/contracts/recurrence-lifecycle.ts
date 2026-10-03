import { randomUUID } from "node:crypto";
import { expect } from "vitest";
import {
  type UnitOfWork,
  WorkflowService,
  WorkService,
} from "../../packages/application/src/index";
import type { ActorContext } from "../../packages/domain/src/index";

export async function recurrenceLifecycleScenario(
  run: <T>(
    actor: ActorContext,
    operation: (uow: UnitOfWork) => Promise<T>,
  ) => Promise<T>,
  inspect: () => Promise<{ activity: readonly { reason?: string | null }[] }>,
) {
  const actor = { workspaceId: "workspace-a", principalId: "human" };
  let now = "2026-03-07T17:00:00.000Z";
  const clock = { now: () => now },
    ids = { next: randomUUID },
    auth = { require: async () => {} };
  const workflow = (uow: UnitOfWork) =>
    new WorkflowService(uow, auth, clock, ids);
  const create = async (closeIncomplete: boolean) =>
    run(actor, (uow) =>
      workflow(uow).saveRecurrence(actor, {
        version: 0,
        deleted: false,
        rule: {
          title: "Daily",
          descriptionMd: "",
          frequency: "DAILY",
          interval: 1,
          startDate: "2026-03-06",
          timezone: "America/New_York",
          closeIncomplete,
        },
      }),
    );
  const definition = await create(true);
  await run(actor, (uow) => workflow(uow).tick(actor, definition.id));
  let records = await run(actor, (uow) => workflow(uow).list(actor));
  const occurrences = records.filter((r) => r.payload.kind === "OCCURRENCE");
  expect(
    occurrences.map((r) =>
      r.payload.kind === "OCCURRENCE" ? r.payload.status : "",
    ),
  ).toEqual(["MISSED", "OPEN"]);
  const open = occurrences.find(
    (r) => r.payload.kind === "OCCURRENCE" && r.payload.status === "OPEN",
  )!;
  if (open.payload.kind !== "OCCURRENCE") throw new Error("Wrong occurrence");
  const taskId = open.payload.taskId!;
  await run(actor, (uow) => workflow(uow).tick(actor, definition.id));
  expect(
    (await run(actor, (uow) => workflow(uow).list(actor))).filter(
      (r) => r.payload.kind === "OCCURRENCE",
    ),
  ).toHaveLength(2);
  now = "2026-03-08T05:00:01.000Z";
  await run(actor, (uow) => workflow(uow).tick(actor, definition.id));
  const closed = await run(actor, (uow) =>
    uow.run(actor.workspaceId, async (tx) => ({
      task: await tx.get(taskId),
    })),
  );
  expect(closed.task.status).toBe("CANCELED");
  expect((await inspect()).activity).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ reason: "RECURRENCE_WINDOW_EXPIRED" }),
    ]),
  );
  records = await run(actor, (uow) => workflow(uow).list(actor));
  const current = records.find((r) => r.id === definition.id)!;
  if (current.payload.kind !== "RECURRENCE")
    throw new Error("Wrong definition");
  const { kind: _, schedulerThrough: _cursor, ...rule } = current.payload;
  const paused = await run(actor, (uow) =>
    workflow(uow).saveRecurrence(actor, {
      id: current.id,
      version: current.version,
      deleted: false,
      rule: { ...rule, state: "PAUSED" },
    }),
  );
  expect(paused.deletedAt).toBeNull();
  now = "2026-03-12T12:00:00.000Z";
  await run(actor, (uow) => workflow(uow).tick(actor, definition.id));
  expect(
    (await run(actor, (uow) => workflow(uow).list(actor))).filter(
      (r) => r.payload.kind === "OCCURRENCE",
    ),
  ).toHaveLength(3);
  const resumed = await run(actor, (uow) =>
    workflow(uow).saveRecurrence(actor, {
      id: paused.id,
      version: paused.version,
      deleted: false,
      rule: { ...rule, state: "ACTIVE" },
    }),
  );
  await run(actor, (uow) => workflow(uow).tick(actor, definition.id));
  records = await run(actor, (uow) => workflow(uow).list(actor));
  expect(records.filter((r) => r.payload.kind === "OCCURRENCE")).toHaveLength(
    4,
  );
  const latest = records.find(
    (r) => r.payload.kind === "OCCURRENCE" && r.payload.day === "2026-03-12",
  )!;
  if (latest.payload.kind !== "OCCURRENCE") throw new Error("Wrong occurrence");
  await run(actor, (uow) =>
    uow.run(actor.workspaceId, async (tx) => {
      const task = await tx.get(
        latest.payload.kind === "OCCURRENCE" ? latest.payload.taskId! : "",
      );
      const scoped: UnitOfWork = {
        run: async (_workspace, operation) => operation(tx),
      };
      await new WorkService(scoped, auth, clock, ids).update(
        actor,
        task.id,
        task.version,
        { status: "DONE" },
      );
    }),
  );
  await run(actor, (uow) => workflow(uow).tick(actor, definition.id));
  expect(
    (await run(actor, (uow) => workflow(uow).list(actor))).find(
      (r) => r.id === latest.id,
    )?.payload,
  ).toMatchObject({ status: "COMPLETED" });
  const terminal = (await run(actor, (uow) => workflow(uow).list(actor))).find(
    (r) => r.id === resumed.id,
  )!;
  await run(actor, (uow) =>
    workflow(uow).saveRecurrence(actor, {
      id: terminal.id,
      version: terminal.version,
      deleted: false,
      rule: { ...rule, state: "ENDED" },
    }),
  );
  now = "2026-03-15T12:00:00.000Z";
  await run(actor, (uow) => workflow(uow).tick(actor, definition.id));
  expect(
    (await run(actor, (uow) => workflow(uow).list(actor))).filter(
      (r) => r.payload.kind === "OCCURRENCE",
    ),
  ).toHaveLength(4);
  const keep = await create(false);
  await run(actor, (uow) => workflow(uow).tick(actor, keep.id));
  const kept = (await run(actor, (uow) => workflow(uow).list(actor))).find(
    (r) =>
      r.payload.kind === "OCCURRENCE" &&
      r.payload.definitionId === keep.id &&
      r.payload.day === "2026-03-15",
  )!;
  now = "2026-03-16T12:00:00.000Z";
  await run(actor, (uow) => workflow(uow).tick(actor, keep.id));
  if (kept.payload.kind !== "OCCURRENCE") throw new Error("Wrong occurrence");
  expect(
    (
      await run(actor, (uow) =>
        uow.run(actor.workspaceId, (tx) =>
          tx.get(
            kept.payload.kind === "OCCURRENCE" ? kept.payload.taskId! : "",
          ),
        ),
      )
    ).status,
  ).toBe("TODO");
  expect(
    (await run(actor, (uow) => workflow(uow).list(actor))).find(
      (r) => r.id === kept.id,
    )?.payload,
  ).toMatchObject({ status: "MISSED" });
}
