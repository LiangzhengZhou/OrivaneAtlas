import {
  type NotificationPermission,
  notificationScope,
} from "@arclattice/application";
import type { ActorContext } from "@arclattice/domain";
import { useEffect, useState } from "react";
import type { Runtime } from "../../bootstrap";

/**
 * Native delivery switch and OS permission only. What gets delivered is decided
 * by the NotificationRecord pipeline (useNotificationCenter): record -> policy
 * -> delivery -> native present. This hook must never schedule toasts itself,
 * otherwise the same logical notification is delivered twice.
 */
export function useNotifications(runtime: Runtime, actor: ActorContext) {
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
    } catch {
      setError(true);
    }
  }
  return { enabled, permission, error, toggle };
}
