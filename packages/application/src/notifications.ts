import {
  type ActorContext,
  DomainError,
  type Reminder,
  type WorkItem,
} from "@arclattice/domain";
import { calendarDateOffset, calendarDayStart } from "./recurrence-lifecycle";
import type { WorkflowRecord } from "./workflows";

export type NotificationKind =
  | "TASK_START"
  | "TASK_DUE"
  | "TASK_OVERDUE"
  | "RECURRENCE_EXPIRING"
  | "DAILY_DIGEST"
  | "REMINDER";
export interface NotificationIntent {
  id: string;
  scope: string;
  kind: NotificationKind;
  entityId: string | null;
  scheduledAt: string;
  timezone: string;
  localDay: string;
  localHour: number;
  title: string;
}
export type NotificationPermission =
  | "granted"
  | "denied"
  | "prompt"
  | "unavailable";
export interface NotificationPort {
  permission(): Promise<NotificationPermission>;
  requestPermission(): Promise<NotificationPermission>;
  reconcile(intents: readonly NotificationIntent[]): Promise<void>;
  cancel(ids: readonly string[]): Promise<void>;
}
export function notificationScope(server: string, actor: ActorContext): string {
  return JSON.stringify([server, actor.workspaceId, actor.principalId]);
}

function localHourInstant(
  day: string,
  timezone: string,
  hour: number,
  minute = 0,
): number {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const target =
    day +
    "T" +
    String(hour).padStart(2, "0") +
    ":" +
    String(minute).padStart(2, "0");
  let low = calendarDayStart(day, timezone),
    high = calendarDayStart(calendarDateOffset(day, 1), timezone);
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    const parts = formatter.formatToParts(new Date(middle));
    const value = (name: string) =>
      parts.find((part) => part.type === name)?.value ?? "";
    const local =
      value("year").padStart(4, "0") +
      "-" +
      value("month") +
      "-" +
      value("day") +
      "T" +
      value("hour") +
      ":" +
      value("minute");
    if (local < target) low = middle + 1;
    else high = middle;
  }
  return low;
}

/** Pure snapshot planning. Native scheduling owns delivery after the application exits. */
export class NotificationPlanner {
  plan(input: {
    server: string;
    actor: ActorContext;
    items: readonly WorkItem[];
    workflows: readonly WorkflowRecord[];
    reminders?: readonly Reminder[];
    timezone: string;
    today: string;
    now: string;
    horizonDays?: number;
    hour?: number;
    dailyDigest?: boolean;
    locale?: "en-US" | "zh-CN";
  }): NotificationIntent[] {
    const horizon = input.horizonDays ?? 7,
      hour = input.hour ?? 9;
    if (
      !Number.isInteger(horizon) ||
      horizon < 1 ||
      horizon > 30 ||
      !Number.isInteger(hour) ||
      hour < 0 ||
      hour > 23 ||
      !Number.isFinite(Date.parse(input.now))
    )
      throw new DomainError("VALIDATION_ERROR");
    const scope = notificationScope(input.server, input.actor),
      end = calendarDayStart(
        calendarDateOffset(input.today, horizon),
        input.timezone,
      ),
      now = Date.parse(input.now);
    const intents: NotificationIntent[] = [];
    const labels =
      input.locale === "zh-CN"
        ? {
            TASK_START: "任务开始",
            TASK_DUE: "任务到期",
            TASK_OVERDUE: "任务逾期",
            RECURRENCE_EXPIRING: "周期任务窗口即将关闭",
            DAILY_DIGEST: "每日任务摘要",
            REMINDER: "提醒",
          }
        : {
            TASK_START: "Task starts",
            TASK_DUE: "Task due",
            TASK_OVERDUE: "Task overdue",
            RECURRENCE_EXPIRING: "Recurring task window closing",
            DAILY_DIGEST: "Daily task digest",
            REMINDER: "Reminder",
          };
    const add = (
      kind: NotificationKind,
      entityId: string | null,
      day: string,
      timezone = input.timezone,
      instant = localHourInstant(day, timezone, hour),
    ) => {
      if (instant < now || instant >= end) return;
      intents.push({
        id: JSON.stringify([scope, kind, entityId, day]),
        scope,
        kind,
        entityId,
        scheduledAt: new Date(instant).toISOString(),
        timezone,
        localDay: day,
        localHour: hour,
        title: labels[kind],
      });
    };
    for (const task of input.items) {
      if (
        task.workspaceId !== input.actor.workspaceId ||
        task.deletedAt ||
        task.type !== "TASK" ||
        task.status === "DONE" ||
        task.status === "CANCELED"
      )
        continue;
      if (task.startDate) add("TASK_START", task.id, task.startDate);
      if (task.dueDate) {
        add("TASK_DUE", task.id, task.dueDate);
        add("TASK_OVERDUE", task.id, calendarDateOffset(task.dueDate, 1));
      }
    }
    for (const reminder of input.reminders ?? []) {
      if (
        reminder.workspaceId !== input.actor.workspaceId ||
        reminder.deletedAt ||
        reminder.state !== "ACTIVE" ||
        reminder.notifyMode === "NONE" ||
        !reminder.time
      )
        continue;
      const [reminderHour, minute] = reminder.time.split(":").map(Number);
      const instant =
        localHourInstant(
          reminder.day,
          reminder.timezone,
          reminderHour!,
          minute!,
        ) -
        (reminder.notifyMode === "MINUTES_BEFORE"
          ? (reminder.notifyOffsetMinutes ?? 0)
          : 0) *
          60000;
      const length = intents.length;
      add("REMINDER", reminder.id, reminder.day, reminder.timezone, instant);
      if (intents.length > length) {
        const intent = intents[intents.length - 1]!;
        intent.title = reminder.title;
        intent.localHour = reminderHour!;
      }
    }
    for (const record of input.workflows) {
      const occurrence = record.payload;
      if (
        record.workspaceId !== input.actor.workspaceId ||
        record.deletedAt ||
        occurrence.kind !== "OCCURRENCE" ||
        occurrence.status !== "OPEN" ||
        !occurrence.expiresAt
      )
        continue;
      add(
        "RECURRENCE_EXPIRING",
        record.id,
        occurrence.day,
        occurrence.ruleSnapshot?.timezone ?? input.timezone,
        Date.parse(occurrence.expiresAt) - 3600000,
      );
    }
    if (input.dailyDigest)
      for (let offset = 0; offset < horizon; offset++)
        add("DAILY_DIGEST", null, calendarDateOffset(input.today, offset));
    return intents.sort(
      (a, b) =>
        a.scheduledAt.localeCompare(b.scheduledAt) || a.id.localeCompare(b.id),
    );
  }
}
