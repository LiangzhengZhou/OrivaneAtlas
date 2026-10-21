import {
  type LocalRecordWrite,
  LocalRuntime,
  LocalWorkspace,
  type NotificationCause,
  NotificationCenterService,
} from "@arclattice/application";
import { IDBFactory } from "fake-indexeddb";
import { expect, it } from "vitest";
import { IndexedDbLocalStore } from "./indexed-db";

const W = "11111111-1111-4111-8111-111111111111";
const cause = (
  subjectId: string,
  occasion = "2026-03-08",
): NotificationCause => ({
  workspaceId: W,
  reason: "REMINDER_DUE",
  subjectId,
  occasion,
  title: "Reminder due",
  body: "Private body",
  target: { kind: "TASK", id: subjectId, route: "/tasks/" + subjectId },
  targetVersion: 1,
  timezone: "UTC",
  fireAt: "2026-03-08T09:00:00.000Z",
});
let counter = 0;
const service = (
  store: IndexedDbLocalStore,
  now = "2026-03-08T10:00:00.000Z",
  workspace = W,
) =>
  new NotificationCenterService(
    store.notifications,
    workspace,
    "UTC",
    () => now,
    () => "00000000-0000-4000-8000-" + String(++counter).padStart(12, "0"),
  );
const granted = {
  permission: async () => "granted" as const,
  present: async () => undefined,
};

it("notification changes reach both connections without waking business snapshots", async () => {
  const factory = new IDBFactory();
  const first = await IndexedDbLocalStore.open("notification-events", factory);
  const second = await IndexedDbLocalStore.open("notification-events", factory);
  let firstBusiness = 0,
    secondBusiness = 0,
    firstNotifications = 0,
    secondNotifications = 0;
  const stops = [
    first.metadata.subscribe!(W, () => firstBusiness++),
    second.metadata.subscribe!(W, () => secondBusiness++),
    first.notifications.subscribe!(W, () => firstNotifications++),
    second.notifications.subscribe!(W, () => secondNotifications++),
  ];
  try {
    await service(first).ingest([cause("notification-only")]);
    await expect.poll(() => secondNotifications).toBe(1);
    expect(firstNotifications).toBe(1);
    expect(firstBusiness).toBe(0);
    expect(secondBusiness).toBe(0);
    let notificationUpdate: LocalRecordWrite | undefined;
    const runtime = new LocalRuntime(
      new LocalWorkspace(
        {
          ...first.metadata,
          commit: (workspaceId, principalId, writes, records = []) =>
            first.metadata.commit(workspaceId, principalId, writes, [
              ...records,
              ...(notificationUpdate ? [notificationUpdate] : []),
            ]),
        },
        { get: async () => null, put: async () => {} },
        {
          schemaVersion: 1,
          workspaceId: W,
          principalId: "22222222-2222-4222-8222-222222222222",
          deviceId: "33333333-3333-4333-8333-333333333333",
        },
        { extract: () => [], resolve: () => [] },
        { now: () => "2026-03-08T10:00:00Z" },
        { next: () => crypto.randomUUID() },
      ),
    );
    await runtime.service.create(runtime.context, { title: "Business task" });
    await expect.poll(() => secondBusiness).toBe(1);
    expect(firstBusiness).toBe(1);
    expect(firstNotifications).toBe(1);
    expect(secondNotifications).toBe(1);
    const record = (await first.metadata.list(W, "$local.notification"))[0]!;
    if (
      !record.value ||
      typeof record.value !== "object" ||
      Array.isArray(record.value)
    )
      throw new Error("EXPECTED_NOTIFICATION");
    notificationUpdate = {
      expectedVersion: record.version,
      entity: {
        ...record,
        version: record.version + 1,
        value: {
          ...record.value,
          version: record.version + 1,
          title: "Updated",
        },
      },
    };
    await runtime.service.create(runtime.context, {
      title: "Atomic record update",
    });
    await expect.poll(() => secondNotifications).toBe(2);
    expect(firstNotifications).toBe(2);
    expect((await service(second).visible())[0]!.title).toBe("Updated");
  } finally {
    for (const stop of stops) stop();
    first.close();
    second.close();
  }
});

it.each([false, true])(
  "recovers native ACK through IndexedDB reopen after local commit persisted=%s",
  async (persisted) => {
    const factory = new IDBFactory();
    const name = `notification-ack-${persisted}`;
    const first = await IndexedDbLocalStore.open(name, factory);
    const initial = service(first, "2026-03-08T08:00:00Z");
    await initial.ingest([cause("ack")]);
    const accepted = new Map<string, number>();
    let shown = 0;
    const native = {
      ...granted,
      present: async () => {
        shown++;
      },
      reconcile: async (
        intents: readonly { id: string; deliverAtMs: number }[],
      ) => {
        for (const intent of intents)
          accepted.set(intent.id, intent.deliverAtMs);
        return intents
          .filter((intent) => accepted.get(intent.id) === intent.deliverAtMs)
          .map(({ id, deliverAtMs }) => ({ id, deliverAtMs }));
      },
    };
    const interrupted = new NotificationCenterService(
      {
        ...first.notifications,
        commit: async (workspace, writes) => {
          if (persisted) await first.notifications.commit(workspace, writes);
          throw new Error("LOCAL_ACK_RESPONSE_INTERRUPTED");
        },
      },
      W,
      "UTC",
      () => "2026-03-08T08:00:00Z",
    );
    const live = async () => ({ exists: true, version: null });
    await expect(interrupted.reconcileSchedules(native, live)).rejects.toThrow(
      "LOCAL_ACK_RESPONSE_INTERRUPTED",
    );
    first.close?.();
    const reopened = await IndexedDbLocalStore.open(name, factory);
    const restart = service(reopened);
    await restart.reconcileSchedules(native, live);
    await restart.deliverDue(native, live);
    await restart.reconcileSchedules(native, live);
    expect(shown).toBe(0);
    expect((await restart.list())[0]!.delivery.state).toBe("SCHEDULED");
    expect(await restart.ingest([cause("ack")])).toBe(0);
    reopened.close?.();
  },
);

it("persists records across a reopen and never duplicates on re-ingest", async () => {
  const factory = new IDBFactory();
  const first = await IndexedDbLocalStore.open("n1", factory);
  expect(await service(first).ingest([cause("a"), cause("b")])).toBe(2);
  expect(await service(first).ingest([cause("a")])).toBe(0);
  first.close?.();
  const reopened = await IndexedDbLocalStore.open("n1", factory);
  const restarted = service(reopened);
  expect((await restarted.list()).map((r) => r.target.id).sort()).toEqual([
    "a",
    "b",
  ]);
  // Restart must not re-create a dismissed record either.
  const [a] = (await restarted.list()).filter((r) => r.target.id === "a");
  await restarted.dismiss(a!.id);
  expect(await restarted.ingest([cause("a")])).toBe(0);
  expect((await restarted.visible()).map((r) => r.target.id)).toEqual(["b"]);
});

it("delivers once, survives restart, and rejects a stale CAS write", async () => {
  const factory = new IDBFactory();
  const store = await IndexedDbLocalStore.open("n2", factory);
  const center = service(store);
  await center.ingest([cause("a")]);
  let shown = 0;
  const port = { ...granted, present: async () => void shown++ };
  const open = async () => ({ exists: true, version: null });
  expect((await center.deliverDue(port, open)).delivered).toBe(1);
  expect((await service(store).deliverDue(port, open)).delivered).toBe(0);
  expect(shown).toBe(1);
  const [record] = await center.list();
  // A writer holding the old version must lose.
  await expect(
    store.notifications.commit(W, [
      {
        expectedVersion: record!.version - 1,
        entity: {
          workspaceId: W,
          collection: "$local.notification",
          id: record!.id,
          version: record!.version,
          value: record as never,
        },
      },
    ]),
  ).rejects.toThrow();
});

it("isolates workspaces and persists preferences", async () => {
  const factory = new IDBFactory();
  const store = await IndexedDbLocalStore.open("n3", factory);
  const other = "99999999-9999-4999-8999-999999999999";
  await service(store).ingest([cause("a")]);
  expect(await service(store, undefined, other).list()).toEqual([]);
  const center = service(store);
  const { value } = await center.preferences();
  await center.savePreferences({ ...value, previewContent: false });
  expect((await service(store).preferences()).value.previewContent).toBe(false);
  expect((await service(store).preferences()).version).toBe(1);
});

it("two IndexedDB connections cannot present the same due record concurrently", async () => {
  const factory = new IDBFactory();
  const first = await IndexedDbLocalStore.open("notification-race", factory);
  const second = await IndexedDbLocalStore.open("notification-race", factory);
  try {
    await service(first).ingest([cause("a")]);
    let shown = 0;
    const native = {
      ...granted,
      present: async () => {
        shown++;
      },
    };
    await Promise.all([
      service(first).deliverDue(native, async () => ({
        exists: true,
        version: null,
      })),
      service(second).deliverDue(native, async () => ({
        exists: true,
        version: null,
      })),
    ]);
    expect(shown).toBe(1);
    expect((await service(second).list())[0]!.delivery.state).toBe("DELIVERED");
  } finally {
    first.close?.();
    second.close?.();
  }
});

it("an interrupted delivery claim survives reopen and retries only after its lease expires", async () => {
  const factory = new IDBFactory();
  const store = await IndexedDbLocalStore.open("notification-lease", factory);
  await service(store).ingest([cause("a")]);
  const [record] = await service(store).list();
  const interrupted = {
    ...record!,
    version: record!.version + 1,
    delivery: {
      ...record!.delivery,
      state: "DELIVERING" as const,
      nextRetryAt: "2026-03-08T10:01:00.000Z",
    },
  };
  await store.notifications.commit(W, [
    {
      expectedVersion: record!.version,
      entity: {
        workspaceId: W,
        collection: "$local.notification",
        id: record!.id,
        version: interrupted.version,
        value: JSON.parse(JSON.stringify(interrupted)),
      },
    },
  ]);
  store.close?.();
  const reopened = await IndexedDbLocalStore.open(
    "notification-lease",
    factory,
  );
  try {
    let shown = 0;
    const native = {
      ...granted,
      present: async () => {
        shown++;
      },
    };
    const live = async () => ({ exists: true, version: null });
    await service(reopened).deliverDue(native, live);
    expect(shown).toBe(0);
    await service(reopened, "2026-03-08T10:02:00.000Z").deliverDue(
      native,
      live,
    );
    expect(shown).toBe(1);
    expect((await service(reopened).list())[0]!.delivery.state).toBe(
      "DELIVERED",
    );
  } finally {
    reopened.close?.();
  }
});
