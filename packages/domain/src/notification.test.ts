import { expect, test } from "vitest";
import {
  defaultNotificationPreferences,
  isQuietHour,
  isStaleNotification,
  mergeNotificationRecords,
  mutateNotification,
  type NotificationRecord,
  nativePayload,
  nextAudibleInstant,
  notificationVisibility,
  recordDeliveryAttempt,
  unreadCount,
} from "./notification";

const now = "2026-03-08T12:00:00.000Z";
const record: NotificationRecord = {
  id: "n1",
  workspaceId: "w",
  version: 1,
  source: "TASK",
  reason: "TASK_DUE",
  urgency: "NORMAL",
  dedupeKey: "TASK_DUE:t1:2026-03-08",
  title: "Task due",
  body: "Private body",
  target: { kind: "TASK", id: "t1", route: "/tasks/t1" },
  targetVersion: 3,
  timezone: "America/New_York",
  fireAt: now,
  readAt: null,
  dismissedAt: null,
  snoozedUntil: null,
  delivery: {
    channel: "NATIVE",
    state: "PENDING",
    attempts: 0,
    lastAttemptAt: null,
    deliveredAt: null,
    nextRetryAt: null,
    lastError: null,
  },
  createdAt: now,
  updatedAt: now,
};

test("quiet hours cross midnight and honour the configured timezone", () => {
  const quiet = {
    enabled: true,
    start: "22:00",
    end: "08:00",
    timezone: "Asia/Shanghai",
  };
  // 15:00Z is 23:00 in Shanghai.
  expect(isQuietHour(quiet, Date.parse("2026-03-08T15:00:00Z"))).toBe(true);
  // 02:00Z is 10:00 in Shanghai.
  expect(isQuietHour(quiet, Date.parse("2026-03-08T02:00:00Z"))).toBe(false);
  expect(
    new Date(
      nextAudibleInstant(quiet, Date.parse("2026-03-08T15:00:00Z")),
    ).toISOString(),
  ).toBe("2026-03-09T00:00:00.000Z");
  expect(
    isQuietHour(
      { ...quiet, enabled: false },
      Date.parse("2026-03-08T15:00:00Z"),
    ),
  ).toBe(false);
});

test("read, snooze and dismiss are explicit versioned transitions", () => {
  const read = mutateNotification(record, { kind: "READ" }, now);
  expect(read.version).toBe(2);
  expect(notificationVisibility(read, Date.parse(now))).toBe("READ");
  const snoozed = mutateNotification(
    record,
    { kind: "SNOOZE", until: "2026-03-08T13:00:00.000Z" },
    now,
  );
  expect(notificationVisibility(snoozed, Date.parse(now))).toBe("SNOOZED");
  expect(
    notificationVisibility(snoozed, Date.parse("2026-03-08T13:00:01Z")),
  ).toBe("UNREAD");
  expect(() =>
    mutateNotification(
      record,
      { kind: "SNOOZE", until: "2026-03-08T11:00:00.000Z" },
      now,
    ),
  ).toThrow();
  expect(
    notificationVisibility(
      mutateNotification(record, { kind: "DISMISS" }, now),
      Date.parse(now),
    ),
  ).toBe("DISMISSED");
  expect(unreadCount([record, read], Date.parse(now))).toBe(1);
});

test("stale suppression follows target existence and version", () => {
  expect(isStaleNotification(record, { exists: true, version: 3 })).toBe(false);
  expect(isStaleNotification(record, { exists: true, version: 4 })).toBe(true);
  expect(isStaleNotification(record, { exists: false, version: null })).toBe(
    true,
  );
});

test("delivery retries on a fixed ladder and stops, without touching read state", () => {
  let current = record;
  for (let index = 0; index < 4; index++)
    current = recordDeliveryAttempt(current, { ok: false, error: "x" }, now);
  expect(current.delivery.nextRetryAt).not.toBeNull();
  current = recordDeliveryAttempt(current, { ok: false, error: "x" }, now);
  expect(current.delivery.nextRetryAt).toBeNull();
  expect(current.readAt).toBeNull();
  expect(recordDeliveryAttempt(current, { ok: true }, now).delivery.state).toBe(
    "DELIVERED",
  );
});

test("privacy preview hides body from native payload", () => {
  const preferences = {
    ...defaultNotificationPreferences("UTC"),
    previewContent: false,
  };
  const payload = nativePayload(record, preferences, "Orivane Atlas");
  expect(JSON.stringify(payload)).not.toContain("Private body");
  expect(payload.route).toBe("/tasks/t1");
});

test("multi-device merge is monotonic for read and dismiss", () => {
  const remote = { ...record, version: 5, readAt: "2026-03-08T11:00:00.000Z" };
  const merged = mergeNotificationRecords(record, remote);
  expect(merged.readAt).toBe("2026-03-08T11:00:00.000Z");
  expect(merged.version).toBe(6);
  expect(() =>
    mergeNotificationRecords(record, { ...remote, dedupeKey: "other" }),
  ).toThrow();
});
