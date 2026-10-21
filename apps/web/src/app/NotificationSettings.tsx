import {
  type NotificationPreferences,
  type NotificationSource,
  notificationSources,
} from "@arclattice/domain";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { useNotificationCenter } from "./hooks/useNotificationCenter";
import type { useNotifications } from "./hooks/useNotifications";
export function NotificationSettings({
  notifications,
  center,
}: {
  notifications: ReturnType<typeof useNotifications>;
  center: Pick<
    ReturnType<typeof useNotificationCenter>,
    "preferences" | "savePreferences"
  >;
}) {
  const { i18n } = useTranslation();
  const zh = i18n.language.startsWith("zh");
  const [preferences, setPreferences] =
    useState<NotificationPreferences | null>(null);
  const [failed, setFailed] = useState(false);
  const saves = useRef<Promise<void>>(Promise.resolve());
  useEffect(() => {
    let active = true;
    void center.preferences().then(
      ({ value }) => {
        if (active) setPreferences(value);
      },
      () => {
        if (active) setFailed(true);
      },
    );
    return () => {
      active = false;
    };
  }, [center.preferences]);
  const labels: Record<NotificationSource, string> = {
    REMINDER: zh ? "提醒" : "Reminders",
    TASK: zh ? "任务" : "Tasks",
    MILESTONE: zh ? "里程碑" : "Milestones",
    RECURRENCE: zh ? "周期任务" : "Recurrence",
    FILE: zh ? "文件处理" : "Files",
    ATLAS: "Atlas",
    SYNC: zh ? "同步问题" : "Sync issues",
  };
  const save = (next: NotificationPreferences) => {
    setPreferences(next);
    saves.current = saves.current
      .then(async () => {
        const saved = await center.savePreferences(next);
        if (!saved) {
          setFailed(true);
          const current = await center.preferences();
          setPreferences(current.value);
        }
      })
      .catch(() => setFailed(true));
  };
  return (
    <section className="notification-settings">
      <h2>{zh ? "通知" : "Notifications"}</h2>
      <p>
        {zh
          ? "原生应用使用系统调度，在关闭应用后仍可通知。网页不支持后台系统调度。"
          : "Native apps schedule reminders with the operating system, including after the app closes. Web scheduling is unavailable."}
      </p>
      {failed && (
        <p role="alert">
          {zh ? "无法读取通知偏好" : "Could not load notification preferences"}
        </p>
      )}
      {preferences && (
        <>
          <label className="field checkbox-field">
            <input
              type="checkbox"
              checked={preferences.previewContent}
              onChange={(event) =>
                save({ ...preferences, previewContent: event.target.checked })
              }
            />
            {zh
              ? "在系统通知中显示内容预览"
              : "Show content previews in system notifications"}
          </label>
          <label className="field checkbox-field">
            <input
              type="checkbox"
              checked={preferences.quietHours.enabled}
              onChange={(event) =>
                save({
                  ...preferences,
                  quietHours: {
                    ...preferences.quietHours,
                    enabled: event.target.checked,
                  },
                })
              }
            />
            {zh ? "勿扰时段" : "Quiet hours"}
          </label>
          {preferences.quietHours.enabled && (
            <div className="form-grid">
              <label className="field">
                {zh ? "开始时间" : "Starts at"}
                <input
                  type="time"
                  value={preferences.quietHours.start}
                  onChange={(event) => {
                    if (event.target.value)
                      save({
                        ...preferences,
                        quietHours: {
                          ...preferences.quietHours,
                          start: event.target.value,
                        },
                      });
                  }}
                />
              </label>
              <label className="field">
                {zh ? "结束时间" : "Ends at"}
                <input
                  type="time"
                  value={preferences.quietHours.end}
                  onChange={(event) => {
                    if (event.target.value)
                      save({
                        ...preferences,
                        quietHours: {
                          ...preferences.quietHours,
                          end: event.target.value,
                        },
                      });
                  }}
                />
              </label>
              <p>{preferences.quietHours.timezone}</p>
            </div>
          )}
          <fieldset>
            <legend>
              {zh ? "应用内通知来源" : "In-app notification sources"}
            </legend>
            {notificationSources.map((source) => (
              <label className="field checkbox-field" key={source}>
                <input
                  type="checkbox"
                  checked={(
                    preferences.inAppSources ?? notificationSources
                  ).includes(source)}
                  onChange={(event) => {
                    const enabled = new Set<NotificationSource>(
                      preferences.inAppSources ?? notificationSources,
                    );
                    if (event.target.checked) enabled.add(source);
                    else enabled.delete(source);
                    save({ ...preferences, inAppSources: [...enabled] });
                  }}
                />
                {labels[source]}
              </label>
            ))}
          </fieldset>
          <fieldset>
            <legend>
              {zh ? "系统通知来源" : "System notification sources"}
            </legend>
            {notificationSources.map((source) => (
              <label className="field checkbox-field" key={source}>
                <input
                  type="checkbox"
                  checked={(preferences.systemSources ?? ["REMINDER"]).includes(
                    source,
                  )}
                  onChange={(event) => {
                    const enabled = new Set<NotificationSource>(
                      preferences.systemSources ?? ["REMINDER"],
                    );
                    if (event.target.checked) enabled.add(source);
                    else enabled.delete(source);
                    const next = {
                      ...preferences,
                      systemSources: [...enabled],
                    };
                    save(next);
                  }}
                />
                {labels[source]}
              </label>
            ))}
          </fieldset>
        </>
      )}
      <label className="field checkbox-field">
        <input
          type="checkbox"
          checked={notifications.enabled}
          disabled={notifications.permission === "unavailable"}
          onChange={(event) => void notifications.toggle(event.target.checked)}
        />
        {zh ? "启用系统通知" : "Enable system notifications"}
      </label>
      <p role="status">
        {notifications.error
          ? zh
            ? "通知调度失败，请重试或检查系统权限。"
            : "Scheduling failed. Retry or check system permissions."
          : notifications.permission === "unavailable"
            ? zh
              ? "此平台不可用"
              : "Unavailable on this platform"
            : notifications.permission === "denied"
              ? zh
                ? "系统通知权限已关闭"
                : "System notifications are disabled"
              : notifications.enabled
                ? zh
                  ? "系统通知已开启"
                  : "System notifications are on"
                : zh
                  ? "系统通知已关闭，通知仍会出现在通知中心"
                  : "System notifications are off; items still appear in the notification center"}
      </p>
    </section>
  );
}
