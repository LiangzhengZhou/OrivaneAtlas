import {
  isQuietHour,
  type NotificationPreferences,
  type NotificationReason,
  type NotificationRecord,
  type NotificationTarget,
  type NotificationUrgency,
  nextAudibleInstant,
  notifiableReasons,
} from "@arclattice/domain";

/**
 * Pure policy: decides whether a cause may become a NotificationRecord at all.
 * Sync success, ordinary background sync, generic Atlas suggestions and
 * background completions that need no user action are NOT in `notifiableReasons`
 * and therefore can never be produced here.
 */
export interface NotificationCause {
  readonly workspaceId: string;
  readonly reason: NotificationReason | string;
  readonly subjectId: string | null;
  /** Local calendar day or other discriminator so the same cause repeats per occasion. */
  readonly occasion: string;
  readonly title: string;
  readonly body: string;
  readonly target: NotificationTarget;
  readonly targetVersion: number | null;
  readonly timezone: string;
  readonly fireAt: string;
  /** Required for ASYNC_COMPLETED_REQUESTED: only if the user asked to be told. */
  readonly userRequested?: boolean;
  /** Required for CONFLICT_ACTIONABLE / SYNC_NEEDS_INTERVENTION. */
  readonly needsUserAction?: boolean;
}

const urgencyByReason: Readonly<
  Record<NotificationReason, NotificationUrgency>
> = {
  REMINDER_DUE: "HIGH",
  TASK_START: "NORMAL",
  TASK_DUE: "HIGH",
  TASK_OVERDUE: "HIGH",
  MILESTONE_NEAR: "NORMAL",
  MILESTONE_REACHED: "NORMAL",
  RECURRENCE_EXPIRING: "NORMAL",
  ASYNC_COMPLETED_REQUESTED: "LOW",
  FILE_PROCESSING_FAILED: "NORMAL",
  CONFLICT_ACTIONABLE: "HIGH",
  SYNC_NEEDS_INTERVENTION: "HIGH",
};

export function notificationDedupeKey(cause: NotificationCause): string {
  return JSON.stringify([
    cause.workspaceId,
    cause.reason,
    cause.subjectId,
    cause.occasion,
  ]);
}

export function isNotifiable(
  cause: NotificationCause,
  preferences: NotificationPreferences,
): cause is NotificationCause & { reason: NotificationReason } {
  const source = (notifiableReasons as Record<string, string | undefined>)[
    cause.reason
  ];
  if (!source) return false;
  if ((preferences.disabledSources as readonly string[]).includes(source))
    return false;
  if (cause.reason === "ASYNC_COMPLETED_REQUESTED" && !cause.userRequested)
    return false;
  if (
    (cause.reason === "CONFLICT_ACTIONABLE" ||
      cause.reason === "SYNC_NEEDS_INTERVENTION") &&
    !cause.needsUserAction
  )
    return false;
  return true;
}

/**
 * Builds records for new causes only. `existing` is keyed by dedupeKey, so a
 * cause that already has a record (even dismissed) never produces a second one.
 * Quiet hours move the native delivery time, they never discard the record.
 */
export function produceNotifications(input: {
  causes: readonly NotificationCause[];
  existing: ReadonlyMap<string, NotificationRecord>;
  preferences: NotificationPreferences;
  now: string;
  newId: () => string;
}): NotificationRecord[] {
  const out: NotificationRecord[] = [];
  const seen = new Set<string>();
  for (const cause of input.causes) {
    if (!isNotifiable(cause, input.preferences)) continue;
    const dedupeKey = notificationDedupeKey(cause);
    if (input.existing.has(dedupeKey) || seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    const fire = Date.parse(cause.fireAt);
    if (!Number.isFinite(fire)) continue;
    const quiet = isQuietHour(input.preferences.quietHours, fire);
    const deliverAt = quiet
      ? nextAudibleInstant(input.preferences.quietHours, fire)
      : fire;
    out.push({
      id: input.newId(),
      workspaceId: cause.workspaceId,
      version: 1,
      source: notifiableReasons[cause.reason],
      reason: cause.reason,
      urgency: urgencyByReason[cause.reason],
      dedupeKey,
      title: cause.title,
      body: cause.body,
      target: cause.target,
      targetVersion: cause.targetVersion,
      timezone: cause.timezone,
      fireAt: new Date(fire).toISOString(),
      readAt: null,
      dismissedAt: null,
      snoozedUntil: null,
      delivery: {
        channel: "NATIVE",
        state: quiet ? "SUPPRESSED_QUIET_HOURS" : "PENDING",
        attempts: 0,
        lastAttemptAt: null,
        deliveredAt: null,
        nextRetryAt: quiet ? new Date(deliverAt).toISOString() : null,
        lastError: null,
      },
      createdAt: input.now,
      updatedAt: input.now,
    });
  }
  return out.sort(
    (a, b) => a.fireAt.localeCompare(b.fireAt) || a.id.localeCompare(b.id),
  );
}
