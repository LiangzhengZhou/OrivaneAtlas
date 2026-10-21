import { expect, test, vi } from "vitest";
import type {
  LocalEntity,
  LocalNotificationStore,
  LocalRecordWrite,
} from "./local-persistence";
import {
  NotificationCenterService,
  type NotificationDeliveryPort,
} from "./notification-center";
import type { NotificationCause } from "./notification-policy";

function memoryStore(): LocalNotificationStore & {
  rows: Map<string, LocalEntity>;
} {
  const rows = new Map<string, LocalEntity>();
  const key = (e: LocalEntity) => e.collection + "|" + e.id;
  return {
    rows,
    list: async () =>
      [...rows.values()].filter((e) => e.collection === "$local.notification"),
    getPreferences: async () =>
      rows.get("$local.notificationPreferences|default") ?? null,
    subscribe: () => () => undefined,
    commit: async (_w, writes: readonly LocalRecordWrite[]) => {
      for (const write of writes)
        if (
          (rows.get(key(write.entity))?.version ?? null) !==
          write.expectedVersion
        )
          throw new Error("VERSION_CONFLICT");
      for (const write of writes) rows.set(key(write.entity), write.entity);
    },
  };
}

const cause: NotificationCause = {
  workspaceId: "w",
  reason: "REMINDER_DUE",
  subjectId: "t1",
  occasion: "2026-03-08",
  title: "Reminder due",
  body: "Private",
  target: { kind: "TASK", id: "t1", route: "/tasks/t1" },
  targetVersion: 2,
  timezone: "UTC",
  fireAt: "2026-03-08T09:00:00.000Z",
};
let n = 0;
const make = (store = memoryStore(), now = "2026-03-08T10:00:00.000Z") => ({
  store,
  service: new NotificationCenterService(
    store,
    "w",
    "UTC",
    () => now,
    () => "id" + ++n,
  ),
});
const port = (
  permission: "granted" | "denied" = "granted",
  fail = false,
): NotificationDeliveryPort & { shown: unknown[] } => {
  const shown: unknown[] = [];
  return {
    shown,
    permission: async () => permission,
    present: async (payload) => {
      if (fail) throw new Error("native down");
      shown.push(payload);
    },
  };
};
const live = async () => ({ exists: true, version: 2 });

test("notification view derives visible rows and unread count from one scoped read", async () => {
  const { service, store } = make();
  await service.ingest([
    cause,
    {
      ...cause,
      subjectId: "future",
      fireAt: "2026-03-09T10:00:00.000Z",
    },
  ]);
  const list = vi.spyOn(store, "list");
  const view = await service.view();
  expect(list).toHaveBeenCalledExactlyOnceWith("w");
  expect(view.records).toHaveLength(1);
  expect(view.unread).toBe(1);
  await service.markRead(view.records[0]!.id);
  list.mockClear();
  const read = await service.view();
  expect(list).toHaveBeenCalledExactlyOnceWith("w");
  expect(read.records).toHaveLength(1);
  expect(read.unread).toBe(0);
  await service.dismiss(view.records[0]!.id);
  expect(await service.view()).toEqual({ records: [], unread: 0 });
});

test("in-app visibility is independent of OS delivery and does not erase records", async () => {
  const { service } = make();
  const { value } = await service.preferences();
  await service.savePreferences({
    ...value,
    inAppSources: [],
    systemSources: ["REMINDER"],
  });
  await service.ingest([cause]);
  expect(await service.visible()).toEqual([]);
  expect(await service.unread()).toBe(0);
  const native = port();
  await service.deliverDue(native, live);
  expect(native.shown).toHaveLength(1);
  expect(await service.list()).toHaveLength(1);
  await service.savePreferences({
    ...value,
    inAppSources: ["REMINDER"],
    systemSources: [],
  });
  expect(await service.visible()).toHaveLength(1);
  expect(await service.unread()).toBe(1);
});

test("ordinary Task attention stays in-app until its system source is explicitly enabled", async () => {
  const { service } = make();
  await service.ingest([{ ...cause, reason: "TASK_DUE" }]);
  const native = port();
  await service.deliverDue(native, live);
  expect(native.shown).toEqual([]);
  expect(await service.unread()).toBe(1);
  const { value } = await service.preferences();
  await service.savePreferences({
    ...value,
    systemSources: ["REMINDER", "TASK"],
  });
  await service.deliverDue(native, live);
  expect(native.shown).toHaveLength(1);
});

test("quiet hours defer the native schedule while due attention remains visible in-app", async () => {
  const { service } = make(undefined, "2026-03-08T09:00:00.000Z");
  const { value } = await service.preferences();
  await service.savePreferences({
    ...value,
    quietHours: {
      enabled: true,
      start: "08:00",
      end: "10:00",
      timezone: "UTC",
    },
  });
  await service.ingest([cause]);
  const scheduled: number[] = [];
  const native = {
    ...port(),
    reconcile: async (values: readonly { deliverAtMs: number }[]) => {
      scheduled.push(...values.map((entry) => entry.deliverAtMs));
    },
  };
  expect(await service.visible()).toHaveLength(1);
  await service.reconcileSchedules(native, live);
  expect(scheduled).toEqual([Date.parse("2026-03-08T10:00:00Z")]);
  expect((await service.list())[0]?.fireAt).toBe(cause.fireAt);
  expect(await service.unread()).toBe(1);
  expect(native.shown).toHaveLength(0);
});

test("ingest is idempotent across restarts and survives in the store", async () => {
  const { store, service } = make();
  expect(await service.ingest([cause])).toBe(1);
  expect(await make(store).service.ingest([cause])).toBe(0);
  expect(await make(store).service.unread()).toBe(1);
});

test("pending payload edits update the same record with CAS and never resurrect dismissal", async () => {
  const { service } = make();
  await service.ingest([cause]);
  const before = (await service.list())[0]!;
  const changed = {
    ...cause,
    title: "Updated reminder",
    body: "Updated preview",
    target: { ...cause.target, route: "/calendar" },
    targetVersion: 3,
  };
  expect(await service.ingest([changed])).toBe(0);
  const after = (await service.list())[0]!;
  expect(after.id).toBe(before.id);
  expect(after.version).toBe(before.version + 1);
  expect(after.title).toBe(changed.title);
  expect(after.target.route).toBe("/calendar");
  await service.dismiss(after.id);
  const dismissed = (await service.list())[0]!;
  await service.ingest([{ ...changed, title: "Another edit" }]);
  expect((await service.list())[0]).toEqual(dismissed);
  expect(await service.visible()).toEqual([]);
});

test("reading during native presentation retains the read and delivery acknowledgement", async () => {
  const { service } = make();
  await service.ingest([cause]);
  const id = (await service.list())[0]!.id;
  let presentations = 0;
  const native = {
    ...port(),
    present: async () => {
      presentations++;
      await service.markRead(id);
    },
  };
  expect((await service.deliverDue(native, live)).delivered).toBe(1);
  const record = (await service.list())[0]!;
  expect(record.readAt).not.toBeNull();
  expect(record.delivery.state).toBe("DELIVERED");
  await service.deliverDue(native, live);
  expect(presentations).toBe(1);
});

test("read, snooze and dismiss change what the center shows", async () => {
  const { service } = make();
  await service.ingest([cause]);
  const [record] = await service.list();
  await service.snooze(record!.id, 30);
  expect(await service.visible()).toEqual([]);
  await service.markRead(record!.id);
  expect(await service.unread()).toBe(0);
  await service.dismiss(record!.id);
  expect(await service.visible()).toEqual([]);
});

test("delivery honours permission, privacy, stale suppression and retry", async () => {
  const { service } = make();
  await service.ingest([cause]);
  const denied = port("denied");
  await service.deliverDue(denied, live);
  expect(denied.shown).toEqual([]);
  expect((await service.list())[0]!.delivery.state).toBe(
    "SUPPRESSED_PERMISSION",
  );

  const failing = port("granted", true);
  expect((await service.deliverDue(failing, live)).failed).toBe(1);
  expect((await service.list())[0]!.delivery.state).toBe("FAILED");

  const stale = await service.deliverDue(port(), async () => ({
    exists: true,
    version: 3,
  }));
  expect(stale.stale).toBe(0); // FAILED waits for its retry window first
});

test("stale targets are suppressed instead of delivered", async () => {
  const { service } = make();
  await service.ingest([cause]);
  const ok = port();
  const result = await service.deliverDue(ok, async () => ({
    exists: false,
    version: null,
  }));
  expect(result.stale).toBe(1);
  expect(ok.shown).toEqual([]);
  expect(await service.visible()).toEqual([]);
});

test("privacy preview off sends a generic native payload", async () => {
  const { service } = make();
  await service.ingest([cause]);
  const prefs = await service.preferences();
  await service.savePreferences({ ...prefs.value, previewContent: false });
  const p = port();
  await service.deliverDue(p, live);
  expect(JSON.stringify(p.shown)).not.toContain("Private");
});

test("concurrent writers lose with VERSION_CONFLICT rather than overwriting", async () => {
  const { store, service } = make();
  await service.ingest([cause]);
  const [record] = await service.list();
  const other = make(store).service;
  await other.markRead(record!.id);
  await expect(
    store.commit("w", [
      {
        expectedVersion: record!.version,
        entity: {
          ...(await store.list("w"))[0]!,
          version: record!.version + 1,
        },
      },
    ]),
  ).rejects.toThrow("VERSION_CONFLICT");
});

test("future durable records reconcile to native scheduling, cancel stale schedules and never present early", async () => {
  const { store, service } = make(undefined, "2026-03-08T08:00:00.000Z");
  await service.ingest([cause]);
  const scheduled: unknown[][] = [];
  const native = {
    ...port(),
    reconcile: async (values: readonly unknown[]) => {
      scheduled.push([...values]);
    },
  };
  await service.reconcileSchedules(native, live);
  expect(native.shown).toEqual([]);
  expect(scheduled[0]).toEqual([
    expect.objectContaining({
      id: (await service.list())[0]!.id,
      deliverAtMs: Date.parse(cause.fireAt),
      route: "/tasks/t1",
    }),
  ]);
  expect((await service.list())[0]!.delivery.state).toBe("SCHEDULED");
  await make(store).service.deliverDue(native, live);
  expect(native.shown).toEqual([]);
  await service.reconcileSchedules(native, async () => ({
    exists: false,
    version: null,
  }));
  expect(scheduled.at(-1)).toEqual([]);
  expect((await service.list())[0]!.delivery.state).toBe("SUPPRESSED_STALE");
});

test("two windows must durably claim a due delivery before invoking the native channel", async () => {
  const { store, service } = make();
  await service.ingest([cause]);
  const native = port();
  await Promise.allSettled([
    service.deliverDue(native, live),
    make(store).service.deliverDue(native, live),
  ]);
  expect(native.shown).toHaveLength(1);
});

test("a durable native schedule receipt recovers an interrupted local ACK after the deadline without presenting twice", async () => {
  const store = memoryStore();
  const before = make(store, "2026-03-08T08:00:00.000Z").service;
  await before.ingest([cause]);
  const receipts = new Map<string, number>();
  const native = {
    ...port(),
    reconcile: async (
      intents: readonly { id: string; deliverAtMs: number }[],
    ) => {
      for (const intent of intents)
        if (intent.deliverAtMs > Date.parse("2026-03-08T08:00:00Z"))
          receipts.set(intent.id, intent.deliverAtMs);
      return intents
        .filter((intent) => receipts.get(intent.id) === intent.deliverAtMs)
        .map(({ id, deliverAtMs }) => ({ id, deliverAtMs }));
    },
  };
  const commit = store.commit;
  store.commit = async () => {
    throw new Error("INTERRUPTED_LOCAL_COMMIT");
  };
  await expect(before.reconcileSchedules(native, live)).rejects.toThrow(
    "INTERRUPTED_LOCAL_COMMIT",
  );
  store.commit = commit;
  expect((await before.list())[0]!.delivery.state).toBe("PENDING");
  const restarted = make(store, "2026-03-08T10:00:00.000Z").service;
  await restarted.reconcileSchedules(native, live);
  await restarted.deliverDue(native, live);
  expect(native.shown).toEqual([]);
  expect((await restarted.list())[0]!.delivery.state).toBe("SCHEDULED");
});

test("a committed local schedule with a lost response remains idempotent on restart", async () => {
  const { store, service } = make(undefined, "2026-03-08T08:00:00.000Z");
  await service.ingest([cause]);
  const native = {
    ...port(),
    reconcile: async (values: readonly { id: string; deliverAtMs: number }[]) =>
      values.map(({ id, deliverAtMs }) => ({ id, deliverAtMs })),
  };
  const commit = store.commit;
  store.commit = async (workspace, writes) => {
    await commit(workspace, writes);
    throw new Error("RESPONSE_LOST");
  };
  await expect(service.reconcileSchedules(native, live)).rejects.toThrow(
    "RESPONSE_LOST",
  );
  store.commit = commit;
  const restart = make(store).service;
  await restart.reconcileSchedules(native, live);
  await restart.deliverDue(native, live);
  expect(native.shown).toEqual([]);
  expect((await restart.list())[0]!.delivery.state).toBe("SCHEDULED");
});

test("partial native receipts leave unacknowledged schedules pending and reject forged recovery", async () => {
  const { service } = make(undefined, "2026-03-08T08:00:00.000Z");
  await service.ingest([cause, { ...cause, subjectId: "t2" }]);
  await service.reconcileSchedules(
    {
      ...port(),
      reconcile: async (values) =>
        values.slice(0, 1).map(({ id, deliverAtMs }) => ({ id, deliverAtMs })),
    },
    live,
  );
  expect(
    (await service.list()).map((record) => record.delivery.state).sort(),
  ).toEqual(["PENDING", "SCHEDULED"]);
  await expect(
    service.reconcileSchedules(
      { ...port(), reconcile: async () => [{ id: "foreign", deliverAtMs: 1 }] },
      live,
    ),
  ).rejects.toThrow("INVALID_NOTIFICATION_RECEIPTS");
  expect(
    (await service.list()).map((record) => record.delivery.state).sort(),
  ).toEqual(["PENDING", "SCHEDULED"]);
});

test("schedule receipt recovery cannot revive a stale target or revoked native permission", async () => {
  const { service } = make(undefined, "2026-03-08T08:00:00.000Z");
  await service.ingest([cause]);
  const requests: number[] = [];
  const native = {
    ...port("denied"),
    reconcile: async (
      values: readonly { id: string; deliverAtMs: number }[],
    ) => {
      requests.push(values.length);
      return [];
    },
  };
  await service.reconcileSchedules(native, live);
  expect(requests).toEqual([0]);
  await service.reconcileSchedules(
    { ...native, permission: async () => "granted" },
    async () => ({ exists: false, version: null }),
  );
  expect(requests).toEqual([0, 0]);
  expect((await service.list())[0]!.delivery.state).toBe("SUPPRESSED_STALE");
});
