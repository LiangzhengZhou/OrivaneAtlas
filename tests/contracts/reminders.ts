import { randomUUID } from "node:crypto";
import { expect } from "vitest";
import {
  ReminderService,
  type UnitOfWork,
} from "../../packages/application/src/index";
import type {
  ActorContext,
  ReminderInput,
} from "../../packages/domain/src/index";

export async function reminderScenario(
  run: <T>(
    actor: ActorContext,
    operation: (uow: UnitOfWork) => Promise<T>,
  ) => Promise<T>,
) {
  const actor = { workspaceId: "workspace-a", principalId: "human" };
  const service = (uow: UnitOfWork) =>
    new ReminderService(
      uow,
      { require: async () => {} },
      { now: () => "2026-10-04T00:00:00Z" },
      { next: randomUUID },
    );
  const input: ReminderInput = {
    title: "Call",
    bodyMd: "First\nSecond",
    day: "2026-10-04",
    time: "10:30",
    timezone: "Asia/Shanghai",
    notifyMode: "MINUTES_BEFORE",
    notifyOffsetMinutes: 15,
    linkedProjectId: null,
    linkedTaskId: null,
    state: "ACTIVE",
  };
  const created = await run(actor, (uow) =>
    service(uow).save(actor, null, 0, input),
  );
  expect((await run(actor, (uow) => service(uow).list(actor)))[0]).toEqual(
    created,
  );
  await expect(
    run(actor, (uow) => service(uow).save(actor, created.id, 0, input)),
  ).rejects.toMatchObject({ code: "VERSION_CONFLICT" });
  await expect(
    run(actor, (uow) =>
      service(uow).save(actor, created.id, 1, { ...input, time: null }),
    ),
  ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  const done = await run(actor, (uow) =>
    service(uow).save(actor, created.id, 1, { ...input, state: "DONE" }),
  );
  expect(done).toMatchObject({
    state: "DONE",
    version: 2,
    bodyMd: input.bodyMd,
  });
  const dismissed = await run(actor, (uow) =>
    service(uow).save(actor, created.id, 2, { ...input, state: "DISMISSED" }),
  );
  expect(dismissed.state).toBe("DISMISSED");
  const deleted = await run(actor, (uow) =>
    service(uow).save(actor, created.id, 3, input, true),
  );
  expect(deleted.deletedAt).not.toBeNull();
  const restored = await run(actor, (uow) =>
    service(uow).save(actor, created.id, 4, input),
  );
  expect(restored).toMatchObject({
    deletedAt: null,
    state: "ACTIVE",
    version: 5,
  });
  await expect(
    run(actor, (uow) =>
      uow.run(actor.workspaceId, async (tx) => {
        await tx.saveReminder(
          { ...restored, version: 6, title: "Must roll back" },
          5,
        );
        throw new Error("ROLLBACK");
      }),
    ),
  ).rejects.toThrow("ROLLBACK");
  expect((await run(actor, (uow) => service(uow).list(actor)))[0]).toEqual(
    restored,
  );
}
