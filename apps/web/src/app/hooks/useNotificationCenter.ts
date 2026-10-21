import {
  type NotificationCenterService,
  notificationCauses,
  notificationReminderOccasion,
} from "@arclattice/application";
import type { NotificationRecord } from "@arclattice/domain";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Runtime, Snapshot } from "../../bootstrap";
import { coalescedRefresh } from "../coalesced-refresh";
import { notificationProjection } from "../notification-projection";

export { notificationCauses } from "@arclattice/application";

export function useNotificationCenter(
  runtime: Runtime,
  snapshot: Snapshot,
  today: string,
  locale: "en-US" | "zh-CN",
  loading: boolean,
  systemEnabled: boolean,
  refreshSignal = 0,
) {
  const service: NotificationCenterService = runtime.notificationCenter;
  // When the user has not enabled system notifications the record still exists
  // in-app; delivery reports "denied", which leaves it retryable (not terminal).
  const delivery = useMemo(
    () =>
      systemEnabled
        ? runtime.notificationDelivery
        : {
            ...runtime.notificationDelivery,
            permission: async () => "denied" as const,
          },
    [runtime, systemEnabled],
  );
  const [records, setRecords] = useState<NotificationRecord[]>([]);
  const [unread, setUnread] = useState(0);
  const [error, setError] = useState(false);
  const [instant, setInstant] = useState(Date.now);
  const projection = useRef<
    ReturnType<typeof notificationProjection> | undefined
  >(undefined);
  const projectionScope = JSON.stringify([
    runtime.serverOrigin,
    runtime.context.workspaceId,
    runtime.context.principalId,
  ]);
  projection.current = useMemo(
    () => notificationProjection(snapshot, projectionScope, projection.current),
    [snapshot, projectionScope],
  );
  const relevant = projection.current.value;
  const [attentionRevision, setAttentionRevision] = useState("");
  useEffect(() => {
    let active = true;
    void runtime.notificationAttention().then(
      (mutations) => {
        if (active)
          setAttentionRevision(
            JSON.stringify(
              mutations.map((row) => [
                row.workspaceId,
                row.id,
                row.state,
                row.lastAttemptAt,
                row.createdAt,
              ]),
            ),
          );
      },
      () => {
        if (active) setError(true);
      },
    );
    return () => {
      active = false;
    };
  }, [runtime, snapshot, refreshSignal]);
  useEffect(() => {
    const wake = () => setInstant(Date.now());
    const timer = window.setInterval(wake, 30_000);
    window.addEventListener("focus", wake);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", wake);
    };
  }, []);
  const generation = useRef(0);
  const currentService = useRef(service);
  currentService.current = service;
  const refreshQueue = useMemo(
    () =>
      coalescedRefresh(async () => {
        if (currentService.current !== service) return;
        const mine = ++generation.current;
        const view = await service.view();
        if (mine !== generation.current || currentService.current !== service)
          return;
        setRecords(view.records);
        setUnread(view.unread);
      }),
    [service],
  );
  const refresh = useCallback(() => refreshQueue(false), [refreshQueue]);
  useEffect(() => {
    void refresh().catch(() => setError(true));
    return runtime.subscribeNotifications(
      () => void refresh().catch(() => setError(true)),
    );
  }, [runtime, refresh]);

  const causes = useMemo(
    () =>
      notificationCauses(
        relevant,
        runtime.context.workspaceId,
        today,
        new Date(instant).toISOString(),
        locale,
      ),
    [relevant, runtime, today, locale, instant],
  );
  const signature = useMemo(
    () =>
      JSON.stringify(
        causes.map((cause) => [
          cause.reason,
          cause.subjectId,
          cause.occasion,
          cause.fireAt,
          cause.targetVersion,
          cause.title,
        ]),
      ),
    [causes],
  );
  const targets = useMemo(
    () => ({
      items: new Map(relevant.items.map((item) => [item.id, item])),
      files: new Map((relevant.files ?? []).map((item) => [item.id, item])),
      workflows: new Map(
        (relevant.workflows ?? []).map((item) => [item.id, item]),
      ),
      reminders: new Map(
        (relevant.reminders ?? []).map((item) => [item.id, item]),
      ),
    }),
    [relevant],
  );
  useEffect(() => {
    if (loading) return;
    let active = true;
    void (async () => {
      let failed = false;
      const syncMutations = await runtime.notificationAttention();
      if (!active) return;
      const attention = notificationCauses(
        { items: [], syncMutations },
        runtime.context.workspaceId,
        today,
        new Date(instant).toISOString(),
        locale,
      );
      const actionable = new Set(attention.map((cause) => cause.subjectId));
      // An ingest conflict (e.g. another tab wrote first) must not block delivery
      // of records that already exist; the next pass re-derives causes.
      await service
        .ingest([...causes, ...attention])
        .catch((cause: unknown) => {
          if (
            !(
              cause instanceof Error &&
              (cause.message === "VERSION_CONFLICT" ||
                ("code" in cause && cause.code === "VERSION_CONFLICT"))
            )
          )
            failed = true;
        });
      if (!active) return;
      const resolve = async (record: NotificationRecord) => {
        if (record.target.kind === "SYNC")
          return { exists: actionable.has(record.target.id), version: null };
        if (record.target.kind === "FILE") {
          const file = record.target.id
            ? targets.files.get(record.target.id)
            : undefined;
          return {
            exists:
              !!file &&
              !file.deletedAt &&
              (file.extractionStatus === "FAILED" ||
                file.indexStatus === "FAILED"),
            version: file?.version ?? null,
          };
        }
        // Stale means the CAUSE no longer holds, not that the target was edited.
        // Version is therefore not compared (version: null skips that check).
        if (record.reason === "REMINDER_DUE") {
          const [, , id, occasion] = JSON.parse(record.dedupeKey) as string[];
          const reminder = id ? targets.reminders.get(id) : undefined;
          return {
            exists:
              !!reminder &&
              !reminder.deletedAt &&
              reminder.state === "ACTIVE" &&
              reminder.notifyMode !== "NONE" &&
              notificationReminderOccasion(reminder) === occasion,
            version: null,
          };
        }
        if (record.target.kind !== "TASK" && record.target.kind !== "MILESTONE")
          return { exists: true, version: null };
        const item = record.target.id
          ? targets.items.get(record.target.id)
          : undefined;
        const occasion = (JSON.parse(record.dedupeKey) as string[])[3];
        if (record.reason === "RECURRENCE_EXPIRING") {
          const subject = (JSON.parse(record.dedupeKey) as string[])[2];
          const workflow = subject ? targets.workflows.get(subject) : undefined;
          const occurrence = workflow?.payload;
          return {
            exists:
              !!item &&
              !item.deletedAt &&
              item.status !== "DONE" &&
              item.status !== "CANCELED" &&
              !!workflow &&
              !workflow.deletedAt &&
              occurrence?.kind === "OCCURRENCE" &&
              ["OPEN", "CREATED"].includes(occurrence.status) &&
              occurrence.expiresAt === occasion &&
              Date.parse(occasion ?? "") > instant,
            version: null,
          };
        }
        if (record.reason === "MILESTONE_REACHED")
          return {
            exists:
              !!item &&
              !item.deletedAt &&
              item.type === "MILESTONE" &&
              item.status === "DONE" &&
              item.updatedAt === occasion,
            version: null,
          };
        const open =
          !!item &&
          !item.deletedAt &&
          item.status !== "DONE" &&
          item.status !== "CANCELED";
        return {
          exists:
            open &&
            (record.reason === "TASK_START"
              ? item?.startDate
              : item?.dueDate) === occasion,
          version: null,
        };
      };
      let reconciled = true;
      await service.reconcileSchedules(delivery, resolve).catch(() => {
        failed = true;
        reconciled = false;
      });
      if (!active) return;
      // A failed schedule/receipt reconciliation leaves the external outcome
      // uncertain. Do not immediately bypass it with a second presentation.
      const result = reconciled
        ? await service.deliverDue(delivery, resolve)
        : { delivered: 0, failed: 1, stale: 0 };
      if (active) {
        setError(failed || result.failed > 0);
        await refresh();
      }
    })().catch(() => {
      if (active) setError(true);
    });
    return () => {
      active = false;
    };
  }, [
    signature,
    loading,
    service,
    delivery,
    refresh,
    instant,
    targets,
    attentionRevision,
  ]);

  async function action(operation: () => Promise<void>) {
    try {
      await operation();
      setInstant(Date.now());
      await refresh();
      return true;
    } catch {
      setError(true);
      return false;
    }
  }
  const preferences = useCallback(() => service.preferences(), [service]);

  return {
    records,
    unread,
    error,
    markRead: async (id: string) => {
      await action(() => service.markRead(id));
    },
    markUnread: async (id: string) => {
      await action(() => service.markUnread(id));
    },
    dismiss: async (id: string) => {
      await action(() => service.dismiss(id));
    },
    snooze: async (id: string, minutes: number) => {
      await action(() => service.snooze(id, minutes));
    },
    preferences,
    savePreferences: (value: Parameters<typeof service.savePreferences>[0]) =>
      action(() => service.savePreferences(value)),
  };
}
