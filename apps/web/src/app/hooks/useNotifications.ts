import {
  type NotificationPermission,
  NotificationPlanner,
  notificationScope,
} from "@arclattice/application";
import type { ActorContext } from "@arclattice/domain";
import { useEffect, useMemo, useState } from "react";
import type { Runtime, Snapshot } from "../../bootstrap";

export function useNotifications(
  runtime: Runtime,
  actor: ActorContext,
  snapshot: Snapshot,
  today: string,
  locale: "en-US" | "zh-CN",
  loading: boolean,
) {
  const key =
    "orivane.atlas.notifications.v1:" +
    notificationScope(runtime.serverOrigin, actor);
  const [enabled, setEnabled] = useState(() => {
    try {
      return localStorage.getItem(key) === "true";
    } catch {
      return false;
    }
  });
  const [permission, setPermission] =
    useState<NotificationPermission>("unavailable");
  const [error, setError] = useState(false);
  const [count, setCount] = useState(0);
  const intents = useMemo(
    () =>
      new NotificationPlanner().plan({
        server: runtime.serverOrigin,
        actor,
        items: snapshot.items,
        workflows: snapshot.workflows ?? [],
        timezone: snapshot.calendarTimezone ?? "UTC",
        today,
        now: new Date().toISOString(),
        dailyDigest: true,
        locale,
      }),
    [
      runtime,
      actor,
      snapshot.items,
      snapshot.workflows,
      snapshot.calendarTimezone,
      today,
      locale,
    ],
  );
  const signature = JSON.stringify(intents.slice(0, 256));
  useEffect(() => {
    let active = true;
    void runtime.notifications.permission().then(
      (value) => {
        if (active) setPermission(value);
      },
      () => {
        if (active) setError(true);
      },
    );
    return () => {
      active = false;
    };
  }, [runtime]);
  useEffect(() => {
    if (loading) return;
    let active = true;
    const scheduled =
      enabled && permission === "granted"
        ? (JSON.parse(signature) as typeof intents)
        : [];
    void runtime.notifications.reconcile(scheduled).then(
      () => {
        if (active) {
          setError(false);
          setCount(scheduled.length);
        }
      },
      () => {
        if (active) setError(true);
      },
    );
    return () => {
      active = false;
    };
  }, [runtime, enabled, permission, signature, loading]);
  async function toggle(value: boolean) {
    setError(false);
    try {
      const allowed = value
        ? await runtime.notifications.requestPermission()
        : permission;
      setPermission(allowed);
      const next = value && allowed === "granted";
      localStorage.setItem(key, String(next));
      setEnabled(next);
      if (!next) await runtime.notifications.reconcile([]);
    } catch {
      setError(true);
    }
  }
  return {
    enabled,
    permission,
    error,
    count,
    limited: intents.length > 256,
    toggle,
  };
}
