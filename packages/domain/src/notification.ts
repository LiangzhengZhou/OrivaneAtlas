import { DomainError } from "./index";

/**
 * Three deliberately separate models:
 *  - Reminder (reminder.ts): "when should the user be reminded"
 *  - NotificationRecord: "what user-visible notification was produced"
 *  - NotificationDelivery: "did a system/native channel actually deliver it"
 */
export const notificationSources = [
  "REMINDER",
  "TASK",
  "MILESTONE",
  "RECURRENCE",
  "FILE",
  "ATLAS",
  "SYNC",
] as const;
export type NotificationSource = (typeof notificationSources)[number];

export const notificationUrgencies = ["LOW", "NORMAL", "HIGH"] as const;
export type NotificationUrgency = (typeof notificationUrgencies)[number];

export const notificationReasons = [
  "REMINDER_DUE",
  "TASK_START",
  "TASK_DUE",
  "TASK_OVERDUE",
  "MILESTONE_NEAR",
  "MILESTONE_REACHED",
  "RECURRENCE_EXPIRING",
  "ASYNC_COMPLETED_REQUESTED",
  "FILE_PROCESSING_FAILED",
  "CONFLICT_ACTIONABLE",
  "SYNC_NEEDS_INTERVENTION",
] as const;
export type NotificationReason = (typeof notificationReasons)[number];

/** Which reasons are ever allowed to become a notification. Everything else is noise. */
export const notifiableReasons: Readonly<
  Record<NotificationReason, NotificationSource>
> = {
  REMINDER_DUE: "REMINDER",
  TASK_START: "TASK",
  TASK_DUE: "TASK",
  TASK_OVERDUE: "TASK",
  MILESTONE_NEAR: "MILESTONE",
  MILESTONE_REACHED: "MILESTONE",
  RECURRENCE_EXPIRING: "RECURRENCE",
  ASYNC_COMPLETED_REQUESTED: "ATLAS",
  FILE_PROCESSING_FAILED: "FILE",
  CONFLICT_ACTIONABLE: "SYNC",
  SYNC_NEEDS_INTERVENTION: "SYNC",
};

export type NotificationDeliveryState =
  | "PENDING"
  | "DELIVERING"
  | "SCHEDULED"
  | "DELIVERED"
  | "FAILED"
  | "SUPPRESSED_QUIET_HOURS"
  | "SUPPRESSED_PERMISSION"
  | "SUPPRESSED_STALE"
  | "SUPPRESSED_DUPLICATE";

export interface NotificationDelivery {
  readonly channel: "NATIVE" | "IN_APP";
  readonly state: NotificationDeliveryState;
  readonly attempts: number;
  readonly lastAttemptAt: string | null;
  readonly deliveredAt: string | null;
  readonly nextRetryAt: string | null;
  readonly lastError: string | null;
  readonly scheduledFor?: string | null;
}

export interface NotificationTarget {
  readonly kind:
    | "TASK"
    | "PROJECT"
    | "MILESTONE"
    | "FILE"
    | "DOCUMENT"
    | "ATLAS"
    | "SYNC";
  readonly id: string | null;
  /** Application route used by the deep link. Never an absolute URL. */
  readonly route: string;
}

export interface NotificationRecord {
  readonly id: string;
  readonly workspaceId: string;
  readonly version: number;
  readonly source: NotificationSource;
  readonly reason: NotificationReason;
  readonly urgency: NotificationUrgency;
  /** Stable identity of the cause. Same key → same notification, regardless of device. */
  readonly dedupeKey: string;
  readonly title: string;
  /** Short preview. Omitted from native delivery when privacy preview is off. */
  readonly body: string;
  readonly target: NotificationTarget;
  /** Version of the target when produced. Used for stale suppression. */
  readonly targetVersion: number | null;
  readonly timezone: string;
  readonly fireAt: string;
  readonly readAt: string | null;
  readonly dismissedAt: string | null;
  readonly snoozedUntil: string | null;
  readonly delivery: NotificationDelivery;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface QuietHours {
  readonly enabled: boolean;
  /** Local wall clock, HH:MM. A window may cross midnight. */
  readonly start: string;
  readonly end: string;
  readonly timezone: string;
}

export interface NotificationPreferences {
  readonly quietHours: QuietHours;
  /** When false native surfaces show a generic title, no body. */
  readonly previewContent: boolean;
  /** Per-source opt-out. Missing means enabled. */
  readonly disabledSources: readonly NotificationSource[];
  /** OS delivery is opt-in per source; legacy preferences default to Reminder. */
  readonly systemSources?: readonly NotificationSource[];
  /** Independent in-app visibility; missing preserves all legacy sources. */
  readonly inAppSources?: readonly NotificationSource[];
}

export const defaultNotificationPreferences = (
  timezone: string,
): NotificationPreferences => ({
  quietHours: { enabled: false, start: "22:00", end: "08:00", timezone },
  previewContent: true,
  disabledSources: [],
  systemSources: ["REMINDER"],
});

const clock = /^([01]\d|2[0-3]):([0-5]\d)$/;
export function requireNotificationPreferences(
  value: NotificationPreferences,
): NotificationPreferences {
  if (
    !value ||
    typeof value !== "object" ||
    !value.quietHours ||
    typeof value.quietHours.enabled !== "boolean" ||
    !clock.test(value.quietHours.start) ||
    !clock.test(value.quietHours.end) ||
    typeof value.quietHours.timezone !== "string" ||
    !value.quietHours.timezone ||
    typeof value.previewContent !== "boolean" ||
    !Array.isArray(value.disabledSources) ||
    (value.inAppSources !== undefined &&
      (!Array.isArray(value.inAppSources) ||
        value.inAppSources.some(
          (source) => !notificationSources.includes(source),
        ))) ||
    (value.systemSources !== undefined &&
      (!Array.isArray(value.systemSources) ||
        value.systemSources.some(
          (source) => !notificationSources.includes(source),
        ))) ||
    value.disabledSources.some(
      (source) => !notificationSources.includes(source),
    )
  )
    throw new DomainError("VALIDATION_ERROR");
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value.quietHours.timezone });
  } catch {
    throw new DomainError("VALIDATION_ERROR");
  }
  return value;
}

function localMinutes(instant: number, timezone: string): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(instant));
  const part = (type: string) =>
    Number(parts.find((entry) => entry.type === type)?.value ?? 0);
  return part("hour") * 60 + part("minute");
}

/** True when `instant` falls inside the (possibly midnight-crossing) quiet window in its own timezone. */
export function isQuietHour(quiet: QuietHours, instant: number): boolean {
  if (!quiet.enabled) return false;
  const [startHour, startMinute] = quiet.start.split(":").map(Number);
  const [endHour, endMinute] = quiet.end.split(":").map(Number);
  const start = startHour! * 60 + startMinute!;
  const end = endHour! * 60 + endMinute!;
  if (start === end) return false;
  const now = localMinutes(instant, quiet.timezone);
  return start < end ? now >= start && now < end : now >= start || now < end;
}

/** Earliest instant at or after `instant` that is outside quiet hours (minute resolution, bounded to 24h). */
export function nextAudibleInstant(quiet: QuietHours, instant: number): number {
  if (!isQuietHour(quiet, instant)) return instant;
  const step = 60000;
  let cursor = Math.ceil(instant / step) * step;
  for (let index = 0; index < 24 * 60 + 1; index++) {
    if (!isQuietHour(quiet, cursor)) return cursor;
    cursor += step;
  }
  return cursor;
}

export type NotificationVisibility =
  | "UNREAD"
  | "READ"
  | "SNOOZED"
  | "DISMISSED";
export function notificationVisibility(
  record: NotificationRecord,
  now: number,
): NotificationVisibility {
  if (record.dismissedAt) return "DISMISSED";
  if (record.snoozedUntil && Date.parse(record.snoozedUntil) > now)
    return "SNOOZED";
  return record.readAt ? "READ" : "UNREAD";
}

export function unreadCount(
  records: readonly NotificationRecord[],
  now: number,
): number {
  return records.filter(
    (record) =>
      record.delivery.state !== "SUPPRESSED_STALE" &&
      record.delivery.state !== "SUPPRESSED_DUPLICATE" &&
      Date.parse(record.fireAt) <= now &&
      notificationVisibility(record, now) === "UNREAD",
  ).length;
}

/** A pending notification is stale when its target moved on or its cause disappeared. */
export function isStaleNotification(
  record: NotificationRecord,
  current: { readonly exists: boolean; readonly version: number | null },
): boolean {
  if (!current.exists) return true;
  return (
    record.targetVersion !== null &&
    current.version !== null &&
    current.version !== record.targetVersion
  );
}

export function mutateNotification(
  record: NotificationRecord,
  action:
    | { kind: "READ" | "UNREAD" | "DISMISS" }
    | { kind: "SNOOZE"; until: string },
  now: string,
): NotificationRecord {
  if (!Number.isFinite(Date.parse(now)))
    throw new DomainError("VALIDATION_ERROR");
  const base = { ...record, version: record.version + 1, updatedAt: now };
  switch (action.kind) {
    case "READ":
      return { ...base, readAt: record.readAt ?? now };
    case "UNREAD":
      return { ...base, readAt: null };
    case "DISMISS":
      return {
        ...base,
        dismissedAt: record.dismissedAt ?? now,
        readAt: record.readAt ?? now,
      };
    case "SNOOZE": {
      const until = Date.parse(action.until);
      if (!Number.isFinite(until) || until <= Date.parse(now))
        throw new DomainError("VALIDATION_ERROR");
      return {
        ...base,
        snoozedUntil: action.until,
        fireAt: action.until,
        readAt: null,
        delivery: {
          ...record.delivery,
          state: "PENDING",
          nextRetryAt: null,
          lastError: null,
        },
      };
    }
  }
}

/** Fixed retry ladder; delivery failure never mutates the notification itself. */
const retryDelaysMs = [60_000, 5 * 60_000, 30 * 60_000, 6 * 3_600_000];
export function recordDeliveryAttempt(
  record: NotificationRecord,
  outcome: { ok: true } | { ok: false; error: string },
  now: string,
): NotificationRecord {
  const attempts = record.delivery.attempts + 1;
  if (outcome.ok)
    return {
      ...record,
      version: record.version + 1,
      updatedAt: now,
      delivery: {
        ...record.delivery,
        state: "DELIVERED",
        attempts,
        lastAttemptAt: now,
        deliveredAt: now,
        nextRetryAt: null,
        lastError: null,
      },
    };
  const delay = retryDelaysMs[attempts - 1];
  return {
    ...record,
    version: record.version + 1,
    updatedAt: now,
    delivery: {
      ...record.delivery,
      state: "FAILED",
      attempts,
      lastAttemptAt: now,
      nextRetryAt:
        delay === undefined
          ? null
          : new Date(Date.parse(now) + delay).toISOString(),
      lastError: outcome.error.slice(0, 200),
    },
  };
}

/** What a native channel may show. Privacy off → generic title only. */
export function nativePayload(
  record: NotificationRecord,
  preferences: NotificationPreferences,
  genericTitle: string,
): { title: string; body: string; route: string } {
  return preferences.previewContent
    ? { title: record.title, body: record.body, route: record.target.route }
    : { title: genericTitle, body: "", route: record.target.route };
}

/**
 * Multi-device behaviour: devices generate the same record from the same cause,
 * so the dedupe key is the merge identity. Read/dismiss state wins on any device
 * (monotonic), delivery state stays device-local.
 */
export function mergeNotificationRecords(
  local: NotificationRecord,
  remote: NotificationRecord,
): NotificationRecord {
  if (
    local.dedupeKey !== remote.dedupeKey ||
    local.workspaceId !== remote.workspaceId
  )
    throw new DomainError("VALIDATION_ERROR");
  const earliest = (a: string | null, b: string | null) =>
    a && b ? (a < b ? a : b) : (a ?? b);
  const latest = (a: string | null, b: string | null) =>
    a && b ? (a > b ? a : b) : (a ?? b);
  return {
    ...local,
    version: Math.max(local.version, remote.version) + 1,
    readAt: earliest(local.readAt, remote.readAt),
    dismissedAt: earliest(local.dismissedAt, remote.dismissedAt),
    snoozedUntil: latest(local.snoozedUntil, remote.snoozedUntil),
    updatedAt:
      local.updatedAt > remote.updatedAt ? local.updatedAt : remote.updatedAt,
  };
}
