import type { LibraryFile, Reminder, WorkItem } from "@arclattice/domain";
import type { LocalMutation } from "./local-persistence";
import type { NotificationCause } from "./notification-policy";
import { notificationTimeResolver } from "./notifications";
import { calendarDateOffset } from "./recurrence-lifecycle";
import { taskDueInstant, taskDueOccasion } from "./task-due";
import type { WorkflowRecord } from "./workflows";

export interface NotificationSnapshot {
  items: readonly WorkItem[];
  reminders?: readonly Reminder[];
  files?: readonly LibraryFile[];
  workflows?: readonly WorkflowRecord[];
  syncMutations?: readonly LocalMutation[];
  calendarTimezone?: string;
}

export function notificationReminderOccasion(reminder: Reminder): string {
  return JSON.stringify([
    reminder.day,
    reminder.time,
    reminder.timezone,
    reminder.notifyMode,
    reminder.notifyOffsetMinutes ?? 0,
  ]);
}

/**
 * Derives current and future causes from durable local entities. A future
 * record is invisible until fireAt but can already be scheduled by the OS.
 */
export function notificationCauses(
  snapshot: NotificationSnapshot,
  workspaceId: string,
  today: string,
  now: string,
  locale: "en-US" | "zh-CN",
): NotificationCause[] {
  const zh = locale === "zh-CN";
  const causes: NotificationCause[] = [];
  const localTime = notificationTimeResolver();
  const timezone = snapshot.calendarTimezone ?? "UTC";
  const itemsById = new Map(snapshot.items.map((item) => [item.id, item]));
  for (const mutation of snapshot.syncMutations ?? []) {
    if (
      mutation.workspaceId !== workspaceId ||
      (mutation.state !== "CONFLICT" && mutation.state !== "REJECTED")
    )
      continue;
    causes.push({
      workspaceId,
      reason:
        mutation.state === "CONFLICT"
          ? "CONFLICT_ACTIONABLE"
          : "SYNC_NEEDS_INTERVENTION",
      subjectId: mutation.id,
      occasion: mutation.state,
      title:
        mutation.state === "CONFLICT"
          ? zh
            ? "同步冲突需要处理"
            : "Sync conflict needs review"
          : zh
            ? "有更改未能同步"
            : "Some changes need your attention",
      body: "",
      target: { kind: "SYNC", id: mutation.id, route: "/settings" },
      targetVersion: null,
      timezone,
      fireAt: mutation.lastAttemptAt ?? mutation.createdAt,
      needsUserAction: true,
    });
  }
  for (const workflow of snapshot.workflows ?? []) {
    const occurrence = workflow.payload;
    if (
      workflow.workspaceId !== workspaceId ||
      workflow.deletedAt ||
      occurrence.kind !== "OCCURRENCE" ||
      !["OPEN", "CREATED"].includes(occurrence.status) ||
      !occurrence.expiresAt ||
      !occurrence.taskId
    )
      continue;
    const expiry = Date.parse(occurrence.expiresAt);
    if (
      !Number.isFinite(expiry) ||
      expiry <= Date.parse(now) ||
      expiry > Date.parse(now) + 86400000
    )
      continue;
    const task = itemsById.get(occurrence.taskId);
    if (
      !task ||
      task.deletedAt ||
      task.status === "DONE" ||
      task.status === "CANCELED"
    )
      continue;
    causes.push({
      workspaceId,
      reason: "RECURRENCE_EXPIRING",
      subjectId: workflow.id,
      occasion: occurrence.expiresAt,
      title: zh ? "本次周期任务即将结束" : "Recurrence window closing",
      body: task.title,
      target: { kind: "TASK", id: task.id, route: "/tasks/" + task.id },
      targetVersion: null,
      timezone,
      fireAt: new Date(
        Math.max(Date.parse(workflow.createdAt), expiry - 3600000),
      ).toISOString(),
    });
  }
  for (const file of snapshot.files ?? []) {
    if (
      file.workspaceId !== workspaceId ||
      file.deletedAt ||
      (file.extractionStatus !== "FAILED" && file.indexStatus !== "FAILED") ||
      Date.parse(file.updatedAt) < Date.parse(now) - 3 * 86400000
    )
      continue;
    causes.push({
      workspaceId,
      reason: "FILE_PROCESSING_FAILED",
      subjectId: file.id,
      occasion: file.updatedAt,
      title: zh ? "文件处理失败" : "File processing failed",
      body: file.name,
      target: { kind: "FILE", id: file.id, route: "/files/" + file.id },
      targetVersion: file.version,
      timezone,
      fireAt: file.updatedAt,
    });
  }
  for (const item of snapshot.items) {
    if (
      item.workspaceId === workspaceId &&
      !item.deletedAt &&
      item.type === "MILESTONE" &&
      item.status === "DONE" &&
      Date.parse(item.updatedAt) >= Date.parse(now) - 86400000
    ) {
      causes.push({
        workspaceId,
        reason: "MILESTONE_REACHED",
        subjectId: item.id,
        occasion: item.updatedAt,
        title: zh ? "里程碑已达成" : "Milestone reached",
        body: item.title,
        target: {
          kind: "MILESTONE",
          id: item.id,
          route: "/milestones/" + item.id,
        },
        targetVersion: null,
        timezone,
        fireAt: item.updatedAt,
      });
    }
    if (
      item.workspaceId !== workspaceId ||
      item.deletedAt ||
      item.status === "DONE" ||
      item.status === "CANCELED"
    )
      continue;
    const isMilestone = item.type === "MILESTONE";
    if (item.type !== "TASK" && !isMilestone) continue;
    const kind = isMilestone ? "MILESTONE" : "TASK";
    const route = (isMilestone ? "/milestones/" : "/tasks/") + item.id;
    const make = (
      reason: string,
      day: string,
      title: string,
    ): NotificationCause => {
      const dueOccasion = reason === "TASK_DUE" ? taskDueOccasion(item) : null;
      const dueInstant =
        reason === "TASK_DUE" ? taskDueInstant(item, timezone) : null;
      return {
        workspaceId,
        reason,
        subjectId: item.id,
        occasion: dueOccasion ?? day,
        title,
        body: item.title,
        target: { kind, id: item.id, route },
        targetVersion: item.version,
        timezone,
        fireAt:
          reason === "TASK_OVERDUE"
            ? now
            : dueInstant !== null
              ? new Date(dueInstant).toISOString()
              : new Date(localTime(day, timezone, 9)).toISOString(),
      };
    };
    if (
      item.startDate &&
      item.startDate >= today &&
      item.startDate <= calendarDateOffset(today, 7) &&
      !isMilestone
    ) {
      causes.push(
        make("TASK_START", item.startDate, zh ? "任务开始" : "Task starts"),
      );
    }
    if (
      item.dueDate &&
      item.dueDate >= today &&
      item.dueDate <= calendarDateOffset(today, 7)
    )
      causes.push(
        make(
          isMilestone ? "MILESTONE_NEAR" : "TASK_DUE",
          item.dueDate,
          isMilestone
            ? zh
              ? "里程碑到期"
              : "Milestone due"
            : zh
              ? "任务今天到期"
              : "Task due",
        ),
      );
    else if (
      item.dueDate &&
      item.dueDate < today &&
      item.dueDate >= calendarDateOffset(today, -3) &&
      !isMilestone
    )
      // Only recently overdue work notifies; old backlog must not flood the center.
      causes.push(
        make("TASK_OVERDUE", item.dueDate, zh ? "任务已逾期" : "Task overdue"),
      );
  }
  for (const reminder of snapshot.reminders ?? []) {
    if (
      reminder.workspaceId !== workspaceId ||
      reminder.deletedAt ||
      reminder.state !== "ACTIVE" ||
      reminder.notifyMode === "NONE" ||
      !reminder.time ||
      reminder.day > calendarDateOffset(today, 7)
    )
      continue;
    const reminderAt =
      localTime(
        reminder.day,
        reminder.timezone,
        Number(reminder.time.slice(0, 2)),
        Number(reminder.time.slice(3, 5)),
      ) -
      (reminder.notifyMode === "MINUTES_BEFORE"
        ? (reminder.notifyOffsetMinutes ?? 0) * 60000
        : 0);
    // Restart catches up recent reminders, never floods the OS with old backlog.
    if (reminderAt < Date.parse(now) - 15 * 60000) continue;
    causes.push({
      workspaceId,
      reason: "REMINDER_DUE",
      subjectId: reminder.id,
      occasion: notificationReminderOccasion(reminder),
      title: reminder.title,
      body: "",
      target: {
        kind: reminder.linkedTaskId ? "TASK" : "PROJECT",
        id: reminder.linkedTaskId ?? reminder.linkedProjectId,
        route: reminder.linkedTaskId
          ? "/tasks/" + reminder.linkedTaskId
          : reminder.linkedProjectId
            ? "/projects/" + reminder.linkedProjectId
            : "/calendar",
      },
      targetVersion: null,
      timezone: reminder.timezone,
      fireAt: new Date(reminderAt).toISOString(),
    });
  }
  return causes;
}
