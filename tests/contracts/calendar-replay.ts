import { randomUUID } from "node:crypto";
import { expect } from "vitest";
import {
  CalendarReplayUnitOfWork,
  type UnitOfWork,
  WorkService,
} from "../../packages/application/src/index";
import type { ActorContext } from "../../packages/domain/src/index";

export async function calendarReplayScenario(
  run: <T>(
    actor: ActorContext,
    operation: (uow: UnitOfWork) => Promise<T>,
  ) => Promise<T>,
) {
  const actor = { workspaceId: "workspace-a", principalId: "human" };
  const guarded = (uow: UnitOfWork, baseVersion: number) =>
    new CalendarReplayUnitOfWork(uow, actor.workspaceId, [
      {
        collection: "calendarSettings",
        id: "workspace",
        op: "UPSERT",
        baseVersion,
      },
    ]);
  const service = (uow: UnitOfWork) =>
    new WorkService(
      uow,
      { require: async () => {} },
      { now: () => "2026-10-13T00:00:00Z", calendarTimezone: "UTC" },
      { next: randomUUID },
    );
  await run(actor, async (uow) => {
    const guard = guarded(uow, 0);
    expect(
      await service(guard).setCalendarSettings(actor, 0, "Asia/Shanghai"),
    ).toEqual({ version: 1, timezone: "Asia/Shanghai" });
    expect(guard.acceptedEffects).toEqual([
      {
        collection: "calendarSettings",
        id: "workspace",
        op: "UPSERT",
        version: 1,
        value: { version: 1, timezone: "Asia/Shanghai" },
      },
    ]);
  });
  await expect(
    run(actor, (uow) =>
      service(guarded(uow, 0)).setCalendarSettings(actor, 1, "UTC"),
    ),
  ).rejects.toMatchObject({ code: "VERSION_CONFLICT" });
  await expect(
    run(actor, (uow) =>
      guarded(uow, 1).run(actor.workspaceId, async (tx) => {
        await tx.saveCalendarSettings({ version: 2, timezone: "UTC" }, 1);
        await tx.removeEdge(randomUUID());
      }),
    ),
  ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  expect(
    await run(actor, (uow) =>
      uow.run(actor.workspaceId, (tx) => tx.calendarSettings()),
    ),
  ).toEqual({ version: 1, timezone: "Asia/Shanghai" });
  await expect(
    run(actor, (uow) =>
      service(guarded(uow, 1)).setCalendarSettings(
        actor,
        1,
        "Invalid/Timezone",
      ),
    ),
  ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  expect(
    await run(actor, (uow) =>
      service(guarded(uow, 1)).setCalendarSettings(actor, 1, null),
    ),
  ).toEqual({ version: 2, timezone: null });
}
