import {
  defaultNotificationPreferences,
  isStaleNotification,
  mutateNotification,
  type NotificationPreferences,
  type NotificationRecord,
  nextAudibleInstant,
  notificationVisibility,
  recordDeliveryAttempt,
  requireNotificationPreferences,
  unreadCount,
} from "@arclattice/domain";
import type {
  LocalEntity,
  LocalJson,
  LocalNotificationStore,
} from "./local-persistence";
import {
  type NotificationCause,
  notificationDedupeKey,
  produceNotifications,
} from "./notification-policy";

const RECORD = "$local.notification";
const PREFERENCES = "$local.notificationPreferences";

export interface NotificationDeliveryPort {
  /** Replaces the device's future schedules with this durable desired set. */
  reconcile?(
    schedules: readonly NativeRecordSchedule[],
  ): Promise<readonly NativeScheduleReceipt[] | void>;
  /** Presents one notification through the native/system channel. */
  present(payload: {
    id: string;
    title: string;
    body: string;
    route: string;
    urgency: NotificationRecord["urgency"];
  }): Promise<void>;
  permission(): Promise<"granted" | "denied" | "prompt" | "unavailable">;
}

export interface NativeScheduleReceipt {
  id: string;
  deliverAtMs: number;
}

export interface NativeRecordSchedule {
  id: string;
  scope: string;
  title: string;
  body: string;
  route: string;
  urgency: NotificationRecord["urgency"];
  deliverAtMs: number;
}

export type TargetResolver = (
  record: NotificationRecord,
) => Promise<{ exists: boolean; version: number | null }>;

const asRecord = (entity: LocalEntity) =>
  entity.value as unknown as NotificationRecord;
const entityOf = (record: NotificationRecord): LocalEntity => ({
  workspaceId: record.workspaceId,
  collection: RECORD,
  id: record.id,
  version: record.version,
  value: record as unknown as LocalJson,
});

/**
 * Local-first notification center. Everything is durable before delivery is
 * attempted, so restart recovery is simply "list, then deliver what is due".
 */
export class NotificationCenterService {
  constructor(
    private readonly store: LocalNotificationStore,
    private readonly workspaceId: string,
    private readonly timezone: string,
    private readonly clock: () => string = () => new Date().toISOString(),
    private readonly newId: () => string = () => crypto.randomUUID(),
  ) {}

  async preferences(): Promise<{
    value: NotificationPreferences;
    version: number | null;
  }> {
    const row = await this.store.getPreferences(this.workspaceId);
    return row
      ? {
          value: requireNotificationPreferences(
            row.value as unknown as NotificationPreferences,
          ),
          version: row.version,
        }
      : { value: defaultNotificationPreferences(this.timezone), version: null };
  }

  async savePreferences(next: NotificationPreferences): Promise<void> {
    const current = await this.preferences();
    await this.store.commit(this.workspaceId, [
      {
        expectedVersion: current.version,
        entity: {
          workspaceId: this.workspaceId,
          collection: PREFERENCES,
          id: "default",
          version: (current.version ?? 0) + 1,
          value: requireNotificationPreferences(next) as unknown as LocalJson,
        },
      },
    ]);
  }

  async list(): Promise<NotificationRecord[]> {
    return (await this.store.list(this.workspaceId))
      .map(asRecord)
      .sort((a, b) => b.fireAt.localeCompare(a.fireAt));
  }

  /** Visible = due, not dismissed, not currently snoozed, not suppressed. */
  async visible(): Promise<NotificationRecord[]> {
    const now = Date.parse(this.clock());
    const preferences = (await this.preferences()).value;
    return (await this.list()).filter((record) => {
      if (
        preferences.disabledSources.includes(record.source) ||
        (preferences.inAppSources &&
          !preferences.inAppSources.includes(record.source))
      )
        return false;
      if (Date.parse(record.fireAt) > now) return false;
      if (
        record.delivery.state === "SUPPRESSED_STALE" ||
        record.delivery.state === "SUPPRESSED_DUPLICATE"
      )
        return false;
      const state = notificationVisibility(record, now);
      return state === "UNREAD" || state === "READ";
    });
  }

  async unread(): Promise<number> {
    return unreadCount(await this.visible(), Date.parse(this.clock()));
  }

  async view(): Promise<{ records: NotificationRecord[]; unread: number }> {
    const records = await this.visible();
    return { records, unread: unreadCount(records, Date.parse(this.clock())) };
  }

  /** Persist newly produced records. Dedupe is by key, so repeated calls are idempotent. */
  async ingest(causes: readonly NotificationCause[]): Promise<number> {
    const existing = await this.list();
    const prefs = (await this.preferences()).value;
    const created = produceNotifications({
      causes,
      existing: new Map(existing.map((record) => [record.dedupeKey, record])),
      preferences: prefs,
      now: this.clock(),
      newId: this.newId,
    });
    const byKey = new Map(existing.map((record) => [record.dedupeKey, record]));
    const refreshed = new Map<
      string,
      { expectedVersion: number; entity: LocalEntity }
    >();
    for (const cause of causes) {
      const record = byKey.get(notificationDedupeKey(cause));
      if (
        !record ||
        record.dismissedAt ||
        record.readAt ||
        ![
          "PENDING",
          "SCHEDULED",
          "SUPPRESSED_QUIET_HOURS",
          "SUPPRESSED_PERMISSION",
        ].includes(record.delivery.state)
      )
        continue;
      if (
        record.title === cause.title &&
        record.body === cause.body &&
        record.targetVersion === cause.targetVersion &&
        record.target.kind === cause.target.kind &&
        record.target.id === cause.target.id &&
        record.target.route === cause.target.route
      )
        continue;
      refreshed.set(record.id, {
        expectedVersion: record.version,
        entity: entityOf({
          ...record,
          version: record.version + 1,
          updatedAt: this.clock(),
          title: cause.title,
          body: cause.body,
          targetVersion: cause.targetVersion,
          target: cause.target,
        }),
      });
    }
    if (!created.length && !refreshed.size) return 0;
    await this.store.commit(this.workspaceId, [
      ...created.map((record) => ({
        expectedVersion: null,
        entity: entityOf(record),
      })),
      ...refreshed.values(),
    ]);
    return created.length;
  }

  private async mutate(
    id: string,
    action: Parameters<typeof mutateNotification>[1],
  ) {
    const row = (await this.list()).find((record) => record.id === id);
    if (!row) return;
    const next = mutateNotification(row, action, this.clock());
    await this.store.commit(this.workspaceId, [
      { expectedVersion: row.version, entity: entityOf(next) },
    ]);
  }
  markRead = (id: string) => this.mutate(id, { kind: "READ" });
  markUnread = (id: string) => this.mutate(id, { kind: "UNREAD" });
  dismiss = (id: string) => this.mutate(id, { kind: "DISMISS" });
  snooze = (id: string, minutes: number) =>
    this.mutate(id, {
      kind: "SNOOZE",
      until: new Date(Date.parse(this.clock()) + minutes * 60000).toISOString(),
    });

  /** Only this record-based pipeline owns native schedules. Reconciliation is
   * idempotent after restart and removes completed, dismissed or changed causes.
   * No native business policy is needed: the platform persists this desired set.
   */
  async reconcileSchedules(
    port: NotificationDeliveryPort,
    resolve: TargetResolver,
  ): Promise<void> {
    if (!port.reconcile) return;
    const nowIso = this.clock(),
      now = Date.parse(nowIso);
    const prefs = (await this.preferences()).value;
    const allowed = (await port.permission()) === "granted";
    const desired: NativeRecordSchedule[] = [];
    const recoverable = new Map<string, NotificationRecord>();
    const writes: { expectedVersion: number; entity: LocalEntity }[] = [];
    for (const record of (await this.list()).sort((a, b) =>
      a.fireAt.localeCompare(b.fireAt),
    )) {
      if (
        record.dismissedAt ||
        record.delivery.state === "DELIVERED" ||
        record.delivery.state.startsWith("SUPPRESSED_STALE") ||
        record.delivery.state === "SUPPRESSED_DUPLICATE"
      )
        continue;
      if (isStaleNotification(record, await resolve(record))) {
        writes.push({
          expectedVersion: record.version,
          entity: entityOf({
            ...record,
            version: record.version + 1,
            updatedAt: nowIso,
            delivery: { ...record.delivery, state: "SUPPRESSED_STALE" },
          }),
        });
        continue;
      }
      const at = nextAudibleInstant(
        prefs.quietHours,
        Math.max(
          Date.parse(record.fireAt),
          Date.parse(record.snoozedUntil ?? record.fireAt),
        ),
      );
      if (
        (!allowed ||
          prefs.disabledSources.includes(record.source) ||
          !(prefs.systemSources ?? ["REMINDER"]).includes(record.source)) &&
        record.delivery.state === "SCHEDULED"
      )
        writes.push({
          expectedVersion: record.version,
          entity: entityOf({
            ...record,
            version: record.version + 1,
            updatedAt: nowIso,
            delivery: { ...record.delivery, state: "SUPPRESSED_PERMISSION" },
          }),
        });
      if (
        !allowed ||
        prefs.disabledSources.includes(record.source) ||
        !(prefs.systemSources ?? ["REMINDER"]).includes(record.source) ||
        desired.length >= 256
      )
        continue;
      // Already acknowledged past schedules need no recovery probe and must not
      // consume the bounded slots needed by current/future attention.
      if (at <= now && record.delivery.state === "SCHEDULED") continue;
      desired.push({
        id: record.id,
        scope: this.workspaceId,
        title: prefs.previewContent ? record.title : "Orivane Atlas",
        body: prefs.previewContent ? record.body : "",
        route: record.target.route,
        urgency: record.urgency,
        deliverAtMs: at,
      });
      if (at <= now) {
        recoverable.set(record.id, record);
        continue;
      }
      if (
        record.delivery.state !== "SCHEDULED" ||
        Date.parse(record.delivery.scheduledFor ?? "") !== at
      )
        writes.push({
          expectedVersion: record.version,
          entity: entityOf({
            ...record,
            version: record.version + 1,
            updatedAt: nowIso,
            delivery: {
              ...record.delivery,
              state: "SCHEDULED",
              scheduledFor: new Date(at).toISOString(),
            },
          }),
        });
    }
    // The OS persists first; only its acknowledgement marks SCHEDULED locally.
    // If it rejects the request the local PENDING record remains retryable.
    const receipts = await port.reconcile(desired);
    if (receipts !== undefined) {
      if (
        !Array.isArray(receipts) ||
        receipts.length > desired.length ||
        new Set(receipts.map((receipt) => receipt.id)).size !== receipts.length
      )
        throw new Error("INVALID_NOTIFICATION_RECEIPTS");
      for (const receipt of receipts) {
        const intent = desired.find((intent) => intent.id === receipt.id);
        if (!intent || intent.deliverAtMs !== receipt.deliverAtMs)
          throw new Error("INVALID_NOTIFICATION_RECEIPTS");
        const record = recoverable.get(receipt.id);
        if (record && record.delivery.state !== "SCHEDULED")
          writes.push({
            expectedVersion: record.version,
            entity: entityOf({
              ...record,
              version: record.version + 1,
              updatedAt: nowIso,
              delivery: {
                ...record.delivery,
                state: "SCHEDULED",
                scheduledFor: new Date(receipt.deliverAtMs).toISOString(),
              },
            }),
          });
      }
      // Native adapters must acknowledge every future intent before its local
      // state is advanced; partial scheduling remains retryable after restart.
      const accepted = new Set(receipts.map((receipt) => receipt.id));
      for (let index = writes.length - 1; index >= 0; index--) {
        const write = writes[index]!;
        if (
          asRecord(write.entity).delivery.state === "SCHEDULED" &&
          !accepted.has(write.entity.id)
        )
          writes.splice(index, 1);
      }
    }
    if (writes.length) await this.store.commit(this.workspaceId, writes);
  }

  /**
   * Restart-safe pass: suppress stale records, re-time quiet-hour deferrals,
   * deliver what is due (including retries), prune old terminal records.
   */
  async deliverDue(
    port: NotificationDeliveryPort,
    resolve: TargetResolver,
  ): Promise<{ delivered: number; failed: number; stale: number }> {
    const nowIso = this.clock();
    const now = Date.parse(nowIso);
    const prefs = (await this.preferences()).value;
    const permission = await port.permission();
    const writes: { expectedVersion: number; entity: LocalEntity }[] = [];
    let delivered = 0,
      failed = 0,
      stale = 0;
    for (const record of await this.list()) {
      const state = record.delivery.state;
      const terminal =
        state === "DELIVERED" ||
        state === "SCHEDULED" ||
        state === "SUPPRESSED_STALE" ||
        state === "SUPPRESSED_DUPLICATE";
      if (terminal || Date.parse(record.fireAt) > now) continue;
      if (
        state === "DELIVERING" &&
        record.delivery.nextRetryAt &&
        Date.parse(record.delivery.nextRetryAt) > now
      )
        continue;
      if (record.dismissedAt) continue;
      if (record.snoozedUntil && Date.parse(record.snoozedUntil) > now)
        continue;
      if (
        state === "FAILED" &&
        (!record.delivery.nextRetryAt ||
          Date.parse(record.delivery.nextRetryAt) > now)
      )
        continue;
      const current = await resolve(record);
      if (isStaleNotification(record, current)) {
        stale++;
        writes.push({
          expectedVersion: record.version,
          entity: entityOf({
            ...record,
            version: record.version + 1,
            updatedAt: nowIso,
            delivery: { ...record.delivery, state: "SUPPRESSED_STALE" },
          }),
        });
        continue;
      }
      if (
        permission !== "granted" ||
        prefs.disabledSources.includes(record.source) ||
        !(prefs.systemSources ?? ["REMINDER"]).includes(record.source)
      ) {
        // Still visible in-app; native delivery is not attempted without permission.
        if (state !== "SUPPRESSED_PERMISSION")
          writes.push({
            expectedVersion: record.version,
            entity: entityOf({
              ...record,
              version: record.version + 1,
              updatedAt: nowIso,
              delivery: { ...record.delivery, state: "SUPPRESSED_PERMISSION" },
            }),
          });
        continue;
      }
      const audible = nextAudibleInstant(prefs.quietHours, now);
      if (audible > now) {
        writes.push({
          expectedVersion: record.version,
          entity: entityOf({
            ...record,
            version: record.version + 1,
            updatedAt: nowIso,
            delivery: {
              ...record.delivery,
              state: "SUPPRESSED_QUIET_HOURS",
              nextRetryAt: new Date(audible).toISOString(),
            },
          }),
        });
        continue;
      }
      // CAS before the external side effect: only one tab may present this id.
      // A bounded durable lease makes an interrupted attempt restart-retryable.
      const claimed: NotificationRecord = {
        ...record,
        version: record.version + 1,
        updatedAt: nowIso,
        delivery: {
          ...record.delivery,
          state: "DELIVERING",
          nextRetryAt: new Date(now + 60_000).toISOString(),
        },
      };
      try {
        await this.store.commit(this.workspaceId, [
          { expectedVersion: record.version, entity: entityOf(claimed) },
        ]);
      } catch (error) {
        if (
          error instanceof Error &&
          (error.message === "VERSION_CONFLICT" ||
            ("code" in error && error.code === "VERSION_CONFLICT"))
        )
          continue;
        throw error;
      }
      let outcome: { ok: true } | { ok: false; error: string };
      try {
        await port.present({
          id: record.id,
          title: prefs.previewContent ? record.title : "Orivane Atlas",
          body: prefs.previewContent ? record.body : "",
          route: record.target.route,
          urgency: record.urgency,
        });
        delivered++;
        outcome = { ok: true };
      } catch (error) {
        failed++;
        outcome = {
          ok: false,
          error: error instanceof Error ? error.message : "DELIVERY_FAILED",
        };
      }
      // Persist each acknowledged side effect independently. A read/dismiss
      // during presentation must not roll back other delivery acknowledgements.
      let deliveryRecord = claimed;
      for (let attempt = 0; ; attempt++) {
        try {
          await this.store.commit(this.workspaceId, [
            {
              expectedVersion: deliveryRecord.version,
              entity: entityOf(
                recordDeliveryAttempt(deliveryRecord, outcome, nowIso),
              ),
            },
          ]);
          break;
        } catch (error) {
          if (
            attempt >= 2 ||
            !(error instanceof Error) ||
            !(
              error.message === "VERSION_CONFLICT" ||
              ("code" in error && error.code === "VERSION_CONFLICT")
            )
          )
            throw error;
          const latest = (await this.list()).find(
            (row) => row.id === claimed.id,
          );
          // A newer snooze/delivery owns its own intent. Never overwrite it.
          if (
            !latest ||
            latest.delivery.state !== "DELIVERING" ||
            latest.delivery.nextRetryAt !== claimed.delivery.nextRetryAt
          )
            break;
          deliveryRecord = latest;
        }
      }
    }
    if (writes.length) await this.store.commit(this.workspaceId, writes);
    return { delivered, failed, stale };
  }
}
