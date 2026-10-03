import { useTranslation } from "react-i18next";
import type { useNotifications } from "./hooks/useNotifications";
export function NotificationSettings({
  notifications,
}: {
  notifications: ReturnType<typeof useNotifications>;
}) {
  const { i18n } = useTranslation();
  const zh = i18n.language.startsWith("zh");
  return (
    <section>
      <h2>{zh ? "通知" : "Notifications"}</h2>
      <p>
        {zh
          ? "原生应用使用系统调度，在关闭应用后仍可通知。网页不支持后台系统调度。"
          : "Native apps schedule reminders with the operating system, including after the app closes. Web scheduling is unavailable."}
      </p>
      <label className="field checkbox-field">
        <input
          type="checkbox"
          checked={notifications.enabled}
          disabled={notifications.permission === "unavailable"}
          onChange={(event) => void notifications.toggle(event.target.checked)}
        />
        {zh
          ? "启用任务提醒和每日摘要"
          : "Enable task reminders and daily digest"}
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
              : (zh ? "已调度：" : "Scheduled: ") + notifications.count}
      </p>
      {notifications.limited && (
        <p>
          {zh
            ? "系统队列最多保留最近的 256 条提醒；再次打开应用会更新队列。"
            : "The system queue retains the next 256 reminders and refreshes when the app opens."}
        </p>
      )}
    </section>
  );
}
