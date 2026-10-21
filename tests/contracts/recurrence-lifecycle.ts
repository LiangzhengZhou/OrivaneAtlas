import { randomUUID } from "node:crypto";
import { expect } from "vitest";
import {
  RecurrenceReplayUnitOfWork,
  type UnitOfWork,
  WorkflowService,
  WorkService,
} from "../../packages/application/src/index";
import { stableEntityIds } from "../../packages/application/src/stable-entity-ids";
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
  const stableId = randomUUID(),
    stableInput = {
      version: 0,
      deleted: false,
      rule: {
        title: "Stable paused series",
        descriptionMd: "原始正文\r\n[[Target]]",
        frequency: "DAILY" as const,
        interval: 1,
        startDate: "2026-03-06",
        timezone: "America/New_York",
        state: "PAUSED" as const,
      },
    };
  const stableEffect = {
    collection: "workflows" as const,
    id: stableId,
    op: "UPSERT" as const,
    baseVersion: 0,
  };
  await expect(
    run(actor, (uow) => {
      const guard = new RecurrenceReplayUnitOfWork(
        uow,
        actor.workspaceId,
        actor.principalId,
        [
          stableEffect,
          {
            collection: "items",
            id: randomUUID(),
            op: "UPSERT",
            baseVersion: 0,
          },
        ],
      );
      return workflow(guard).createRecurrenceWithStableId(
        actor,
        stableId,
        stableInput,
      );
    }),
  ).rejects.toThrow("VERSION_CONFLICT");
  expect(
    (await run(actor, (uow) => workflow(uow).list(actor))).some(
      (entry) => entry.id === stableId,
    ),
  ).toBe(false);
  const stable = await run(actor, async (uow) => {
    const guard = new RecurrenceReplayUnitOfWork(
      uow,
      actor.workspaceId,
      actor.principalId,
      [stableEffect],
    );
    const result = await workflow(guard).createRecurrenceWithStableId(
      actor,
      stableId,
      stableInput,
    );
    expect(guard.acceptedEffects).toEqual([
      {
        collection: "workflows",
        id: stableId,
        op: "UPSERT",
        version: 1,
        value: result,
      },
    ]);
    return result;
  });
  expect(stable.id).toBe(stableId);
  expect(stable.version).toBe(1);
  expect(stable.payload).toMatchObject(stableInput.rule);
  await expect(
    run(actor, (uow) =>
      workflow(uow).createRecurrenceWithStableId(actor, stableId, stableInput),
    ),
  ).rejects.toThrow("VERSION_CONFLICT");
  await run(actor, (uow) =>
    workflow(uow).saveRecurrence(actor, {
      ...stableInput,
      id: stableId,
      version: 1,
      deleted: true,
    }),
  );
  await expect(
    run(actor, (uow) =>
      workflow(uow).createRecurrenceWithStableId(actor, stableId, stableInput),
    ),
  ).rejects.toThrow("VERSION_CONFLICT");
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
      organization: (await tx.organizations()).find(
        (entry) => entry.kind === "WORK" && entry.id === taskId,
      ),
    })),
  );
  expect(closed.task.status).toBe("CANCELED");
  expect(closed.organization).toMatchObject({
    archived: true,
    updatedBy: actor.principalId,
  });
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
  const ordinary = await run(actor, (uow) =>
    new WorkService(uow, auth, clock, ids).create(actor, {
      title: "Convert in place",
      descriptionMd: "# Original",
    }),
  );
  const conversion = {
    task: { id: ordinary.id, version: ordinary.version },
    draft: { title: "Converted task", descriptionMd: "# Original" },
    recurrence: {
      version: 0,
      deleted: false,
      rule: {
        title: "Series title",
        descriptionMd: "# Series",
        startDate: "2026-03-16",
        timezone: "UTC",
        frequency: "DAILY" as const,
        interval: 1,
      },
    },
  };
  const converted = await run(actor, (uow) =>
    workflow(uow).saveTaskRecurrence(actor, conversion),
  );
  expect(converted.task?.id).toBe(ordinary.id);
  expect((await inspect()).activity).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ type: "RECURRENCE_TASK_CONVERTED" }),
    ]),
  );
  await run(actor, (uow) => workflow(uow).tick(actor, converted.definition.id));
  const bound = (await run(actor, (uow) => workflow(uow).list(actor))).filter(
    (r) =>
      r.payload.kind === "OCCURRENCE" &&
      r.payload.definitionId === converted.definition.id,
  );
  expect(bound).toHaveLength(1);
  expect(bound[0]?.payload).toMatchObject({
    taskId: ordinary.id,
    ruleSnapshot: { title: "Series title" },
  });
  await expect(
    run(actor, (uow) => workflow(uow).saveTaskRecurrence(actor, conversion)),
  ).rejects.toThrow("VERSION_CONFLICT");
  const afterConvert = converted.task!;
  const currentDefinition = (
    await run(actor, (uow) => workflow(uow).list(actor))
  ).find((r) => r.id === converted.definition.id)!;
  const updated = await run(actor, (uow) =>
    workflow(uow).saveTaskRecurrence(actor, {
      task: { id: afterConvert.id, version: afterConvert.version },
      draft: { title: "Do not rewrite current occurrence" },
      recurrence: {
        id: converted.definition.id,
        version: currentDefinition.version,
        deleted: false,
        rule: { ...conversion.recurrence.rule, title: "Changed series" },
      },
    }),
  );
  expect(updated.task?.title).toBe("Converted task");
  expect(
    (await run(actor, (uow) => workflow(uow).list(actor))).find(
      (r) => r.id === bound[0]?.id,
    )?.payload,
  ).toEqual(bound[0]?.payload);
  const newRepeat = await run(actor, (uow) =>
    workflow(uow).saveTaskRecurrence(actor, {
      draft: { title: "Only one task" },
      recurrence: {
        ...conversion.recurrence,
        rule: { ...conversion.recurrence.rule, title: "Only one task" },
      },
    }),
  );
  expect(newRepeat.task?.title).toBe("Only one task");
  await run(actor, (uow) => workflow(uow).tick(actor, newRepeat.definition.id));
  expect(
    (await run(actor, (uow) => workflow(uow).list(actor))).filter(
      (r) =>
        r.payload.kind === "OCCURRENCE" &&
        r.payload.definitionId === newRepeat.definition.id,
    ),
  ).toHaveLength(1);
  const skipTarget = (
    await run(actor, (uow) => workflow(uow).list(actor))
  ).find(
    (record) =>
      record.payload.kind === "OCCURRENCE" &&
      record.payload.definitionId === newRepeat.definition.id,
  )!;
  const skipped = await run(actor, (uow) =>
    workflow(uow).skipOccurrence(actor, skipTarget.id, skipTarget.version),
  );
  expect(skipped.payload).toMatchObject({
    status: "SKIPPED",
    completedAt: null,
  });
  expect(
    (
      await run(actor, (uow) =>
        uow.run(actor.workspaceId, (tx) => tx.get(newRepeat.task!.id)),
      )
    ).status,
  ).toBe("CANCELED");
  await expect(
    run(actor, (uow) =>
      workflow(uow).skipOccurrence(actor, skipTarget.id, skipTarget.version),
    ),
  ).rejects.toThrow("VERSION_CONFLICT");
  await run(actor, (uow) => workflow(uow).tick(actor, newRepeat.definition.id));
  expect(
    (await run(actor, (uow) => workflow(uow).list(actor))).find(
      (record) => record.id === skipTarget.id,
    )?.payload,
  ).toMatchObject({ status: "SKIPPED" });
  expect((await inspect()).activity).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ reason: "RECURRENCE_USER_SKIPPED" }),
    ]),
  );
  const foreign = { ...actor, workspaceId: "workspace-b" };
  await expect(
    run(foreign, (uow) =>
      workflow(uow).saveTaskRecurrence(foreign, conversion),
    ),
  ).rejects.toThrow("NOT_FOUND");

  // The completion limit counts successful outcomes, never missed/skipped
  // dates. Exercise persistence and repeated ticks through both real adapters.
  now = "2026-05-02T12:00:00.000Z";
  const limited = await run(actor, (uow) =>
    workflow(uow).saveRecurrence(actor, {
      version: 0,
      deleted: false,
      rule: {
        title: "Complete twice",
        descriptionMd: "",
        startDate: "2026-05-01",
        timezone: "UTC",
        frequency: "DAILY",
        interval: 1,
        endAfterCompleted: 2,
      },
    }),
  );
  await run(actor, (uow) => workflow(uow).tick(actor, limited.id));
  const limitedOccurrences = async () =>
    (await run(actor, (uow) => workflow(uow).list(actor))).filter(
      (entry) =>
        entry.payload.kind === "OCCURRENCE" &&
        entry.payload.definitionId === limited.id,
    );
  let limitedRows = await limitedOccurrences();
  expect(
    limitedRows.map((entry) =>
      entry.payload.kind === "OCCURRENCE" ? entry.payload.status : "",
    ),
  ).toEqual(["MISSED", "OPEN"]);
  const toSkip = limitedRows[1]!;
  await run(actor, (uow) =>
    workflow(uow).skipOccurrence(actor, toSkip.id, toSkip.version),
  );
  for (const day of ["2026-05-03", "2026-05-04"]) {
    now = day + "T12:00:00.000Z";
    await run(actor, (uow) => workflow(uow).tick(actor, limited.id));
    const open = (await limitedOccurrences()).find(
      (entry) =>
        entry.payload.kind === "OCCURRENCE" && entry.payload.day === day,
    )!;
    if (open.payload.kind !== "OCCURRENCE" || !open.payload.taskId)
      throw new Error("Expected scheduled task");
    const taskId = open.payload.taskId;
    const task = await run(actor, (uow) =>
      uow.run(actor.workspaceId, (tx) => tx.get(taskId)),
    );
    await run(actor, (uow) =>
      new WorkService(uow, auth, clock, ids).update(
        actor,
        task.id,
        task.version,
        { status: "DONE" },
      ),
    );
    await run(actor, (uow) => workflow(uow).tick(actor, limited.id));
  }
  now = "2026-05-05T12:00:00.000Z";
  await run(actor, (uow) => workflow(uow).tick(actor, limited.id));
  await run(actor, (uow) => workflow(uow).tick(actor, limited.id));
  limitedRows = await limitedOccurrences();
  expect(limitedRows).toHaveLength(4);
  expect(
    limitedRows.filter(
      (entry) =>
        entry.payload.kind === "OCCURRENCE" &&
        entry.payload.status === "COMPLETED",
    ),
  ).toHaveLength(2);
  expect(
    (await run(actor, (uow) => workflow(uow).list(actor))).find(
      (entry) => entry.id === limited.id,
    )?.payload,
  ).toMatchObject({ state: "ENDED", endAfterCompleted: 2 });
  const replayDefinition = await create(true),
    occurrenceId = `occurrence:${replayDefinition.id}:2026-03-06`;
  await run(actor, async (uow) => {
    const guard = new RecurrenceReplayUnitOfWork(
      uow,
      actor.workspaceId,
      actor.principalId,
      [
        {
          collection: "workflows",
          id: occurrenceId,
          op: "UPSERT",
          baseVersion: 0,
        },
      ],
    );
    await workflow(guard).generate(
      actor,
      replayDefinition.id,
      replayDefinition.version,
      "2026-03-06",
      "2026-03-06",
    );
    expect(guard.acceptedEffects[0]?.value).toMatchObject({
      payload: { status: "MISSED", taskId: null },
    });
  });
  const backfilledTaskId = randomUUID();
  await run(actor, async (uow) => {
    const guard = new RecurrenceReplayUnitOfWork(
      uow,
      actor.workspaceId,
      actor.principalId,
      [
        {
          collection: "items",
          id: backfilledTaskId,
          op: "UPSERT",
          baseVersion: 0,
        },
        {
          collection: "items",
          id: backfilledTaskId,
          op: "UPSERT",
          baseVersion: 1,
        },
        {
          collection: "workflows",
          id: occurrenceId,
          op: "UPSERT",
          baseVersion: 1,
        },
      ],
    );
    await new WorkflowService(
      guard,
      auth,
      clock,
      stableEntityIds(ids, "WORK", backfilledTaskId),
    ).backfill(actor, occurrenceId, 1, "2026-03-06T17:00:00.000Z");
    expect(guard.acceptedEffects).toHaveLength(2);
    expect(
      guard.acceptedEffects.find((effect) => effect.collection === "items")
        ?.value,
    ).toMatchObject({ id: backfilledTaskId, version: 2, status: "DONE" });
    expect(
      guard.acceptedEffects.find((effect) => effect.collection === "workflows")
        ?.value,
    ).toMatchObject({
      version: 2,
      payload: { status: "BACKFILLED", taskId: backfilledTaskId },
    });
  });
}
