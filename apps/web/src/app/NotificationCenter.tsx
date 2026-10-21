import type { NotificationRecord } from "@arclattice/domain";
import { Bell, BellOff, Clock, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { IconButton } from "../components/ui/Button";
import { AnchoredFloatingSurface } from "./AnchoredFloatingSurface";
import "./notification-center.css";

const snoozeMinutes = [15, 60, 24 * 60] as const;

function relative(iso: string, language: string): string {
  const delta = Date.parse(iso) - Date.now();
  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ["day", 86_400_000],
    ["hour", 3_600_000],
    ["minute", 60_000],
  ];
  const format = new Intl.RelativeTimeFormat(language, { numeric: "auto" });
  for (const [unit, size] of units)
    if (Math.abs(delta) >= size)
      return format.format(Math.round(delta / size), unit);
  return format.format(0, "minute");
}

export function NotificationBell({
  records,
  unread,
  error = false,
  onOpen,
  onRead,
  onUnread,
  onDismiss,
  onSnooze,
}: {
  records: readonly NotificationRecord[];
  unread: number;
  error?: boolean;
  onOpen(record: NotificationRecord): void;
  onRead(id: string): Promise<void>;
  onUnread(id: string): Promise<void>;
  onDismiss(id: string): Promise<void>;
  onSnooze(id: string, minutes: number): Promise<void>;
}) {
  const { i18n } = useTranslation();
  const zh = i18n.language.startsWith("zh");
  const anchor = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [snoozing, setSnoozing] = useState<string | null>(null);
  useEffect(() => {
    if (!open) setSnoozing(null);
  }, [open]);
  const label = zh
    ? unread
      ? `通知，${unread} 条未读`
      : "通知"
    : unread
      ? `Notifications, ${unread} unread`
      : "Notifications";
  const snoozeLabel = (minutes: number) =>
    minutes === 15
      ? zh
        ? "15 分钟后"
        : "In 15 min"
      : minutes === 60
        ? zh
          ? "1 小时后"
          : "In 1 hour"
        : zh
          ? "明天"
          : "Tomorrow";
  return (
    <>
      <span className="notification-anchor">
        <IconButton
          ref={anchor}
          label={label}
          aria-haspopup="dialog"
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
        >
          <Bell size={17} />
        </IconButton>
        {unread > 0 && <span className="notification-dot" aria-hidden="true" />}
      </span>
      {open && (
        <AnchoredFloatingSurface
          anchorRef={anchor}
          onDismiss={() => setOpen(false)}
          label={zh ? "通知中心" : "Notification Center"}
          role="dialog"
          className="notification-center glass-surface"
          placement="bottom-start"
        >
          <header className="notification-center-head">
            <strong>{zh ? "通知" : "Notifications"}</strong>
            <span className="muted" aria-live="polite">
              {unread
                ? zh
                  ? `${unread} 条未读`
                  : `${unread} unread`
                : zh
                  ? "已读完"
                  : "All caught up"}
            </span>
          </header>
          {error && (
            <p role="alert">
              {zh
                ? "通知保存或系统投递失败。记录仍保留在本机，请检查系统权限后重试。"
                : "A notification could not be saved or delivered. Local records are retained; check system permissions and retry."}
            </p>
          )}
          {records.length === 0 ? (
            <p className="notification-empty">
              <BellOff size={16} aria-hidden="true" />
              {zh
                ? "没有需要处理的通知。到期的提醒和需要你介入的问题会出现在这里。"
                : "Nothing needs you right now. Due reminders and issues that need action appear here."}
            </p>
          ) : (
            <ul className="notification-list">
              {records.map((record) => {
                const isUnread = !record.readAt;
                return (
                  <li
                    key={record.id}
                    className="notification-row"
                    data-urgency={record.urgency}
                    data-unread={isUnread || undefined}
                  >
                    <button
                      type="button"
                      className="notification-main"
                      onClick={() => {
                        void onRead(record.id);
                        setOpen(false);
                        onOpen(record);
                      }}
                    >
                      <span
                        className="notification-marker"
                        aria-hidden="true"
                      />
                      <span className="notification-text">
                        <span className="notification-title">
                          {record.title}
                        </span>
                        {record.body && (
                          <span className="notification-body">
                            {record.body}
                          </span>
                        )}
                      </span>
                      <time
                        className="notification-time"
                        dateTime={record.fireAt}
                      >
                        {relative(record.fireAt, i18n.language)}
                      </time>
                    </button>
                    <span className="notification-actions">
                      {snoozing === record.id ? (
                        snoozeMinutes.map((minutes) => (
                          <button
                            key={minutes}
                            type="button"
                            className="notification-chip"
                            onClick={() => {
                              setSnoozing(null);
                              void onSnooze(record.id, minutes);
                            }}
                          >
                            {snoozeLabel(minutes)}
                          </button>
                        ))
                      ) : (
                        <>
                          <IconButton
                            label={zh ? "稍后提醒" : "Snooze"}
                            onClick={() => setSnoozing(record.id)}
                          >
                            <Clock size={14} />
                          </IconButton>
                          <IconButton
                            label={
                              isUnread
                                ? zh
                                  ? "标为已读"
                                  : "Mark read"
                                : zh
                                  ? "标为未读"
                                  : "Mark unread"
                            }
                            onClick={() =>
                              void (isUnread
                                ? onRead(record.id)
                                : onUnread(record.id))
                            }
                          >
                            <span
                              className="notification-read-glyph"
                              aria-hidden="true"
                            />
                          </IconButton>
                          <IconButton
                            label={zh ? "忽略" : "Dismiss"}
                            onClick={() => void onDismiss(record.id)}
                          >
                            <X size={14} />
                          </IconButton>
                        </>
                      )}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </AnchoredFloatingSurface>
      )}
    </>
  );
}
