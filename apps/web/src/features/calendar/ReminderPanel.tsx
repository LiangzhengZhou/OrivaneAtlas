import type { Reminder, ReminderInput, WorkItem } from "@arclattice/domain";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { DateField } from "../../components/DateField";
import { Button } from "../../components/ui/Button";
import { Dialog, Select } from "../../components/ui/Surfaces";
import { ProjectDrilldownPicker } from "../projects/ProjectDrilldownPicker";
import { TaskEntityPicker } from "../tasks/TaskEntityPicker";

export function ReminderPanel({
  day,
  timezone,
  reminders,
  save,
  items = [],
  createRequest = 0,
  hideCreate = false,
}: {
  day: string;
  timezone: string;
  reminders: readonly Reminder[];
  items?: readonly WorkItem[];
  createRequest?: number;
  hideCreate?: boolean;
  save(
    id: string | null,
    version: number,
    input: ReminderInput,
    deleted?: boolean,
  ): Promise<boolean>;
}) {
  const { i18n } = useTranslation();
  const text = (zh: string, en: string) =>
    i18n.language.startsWith("zh") ? zh : en;
  const [draft, setDraft] = useState<ReminderInput | null>(null);
  const [editing, setEditing] = useState<Reminder | null>(null);
  const [pending, setPending] = useState(false);
  const [removed, setRemoved] = useState<Reminder | null>(null);
  const lastCreateRequest = useRef(0);
  const beginCreate = () => {
    setEditing(null);
    setDraft({
      title: "",
      bodyMd: "",
      day,
      time: null,
      timezone,
      notifyMode: "NONE",
      notifyOffsetMinutes: null,
      linkedProjectId: null,
      linkedTaskId: null,
      state: "ACTIVE",
    });
  };
  useEffect(() => {
    if (createRequest && createRequest !== lastCreateRequest.current) {
      lastCreateRequest.current = createRequest;
      beginCreate();
    }
  }, [createRequest, day, timezone]);
  async function submit(
    id: string | null,
    version: number,
    value: ReminderInput,
    deleted = false,
  ) {
    if (pending) return false;
    setPending(true);
    try {
      const {
        title,
        bodyMd,
        day,
        time,
        timezone,
        notifyMode,
        notifyOffsetMinutes,
        linkedProjectId,
        linkedTaskId,
        state,
      } = value;
      return await save(
        id,
        version,
        {
          title,
          bodyMd,
          day,
          time,
          timezone,
          notifyMode,
          notifyOffsetMinutes,
          linkedProjectId,
          linkedTaskId,
          state,
        },
        deleted,
      );
    } finally {
      setPending(false);
    }
  }
  return (
    <div className="calendar-reminders">
      {reminders.length > 0 && (
        <h3>
          {text("提醒", "Reminders")}{" "}
          <span className="muted" data-count={reminders.length}>
            {reminders.length}
          </span>
        </h3>
      )}
      {reminders
        .filter((entry) => !entry.deletedAt)
        .map((entry) => (
          <article key={entry.id}>
            <Button
              variant="text"
              onClick={() => {
                setEditing(entry);
                setDraft(entry);
              }}
            >
              {entry.time} {entry.title}
            </Button>
            <small>
              {text(
                entry.state === "DONE"
                  ? "已完成"
                  : entry.state === "DISMISSED"
                    ? "已忽略"
                    : "待提醒",
                entry.state === "DONE"
                  ? "Done"
                  : entry.state === "DISMISSED"
                    ? "Dismissed"
                    : "Active",
              )}
            </small>
            {entry.state === "ACTIVE" && (
              <div className="action-row">
                <Button
                  pending={pending}
                  onClick={() =>
                    void submit(entry.id, entry.version, {
                      ...entry,
                      state: "DONE",
                    })
                  }
                >
                  {text("完成", "Complete")}
                </Button>
                <Button
                  disabled={pending}
                  onClick={() =>
                    void submit(entry.id, entry.version, {
                      ...entry,
                      state: "DISMISSED",
                    })
                  }
                >
                  {text("忽略", "Dismiss")}
                </Button>
              </div>
            )}
            <Button
              variant="text"
              disabled={pending}
              onClick={async () => {
                if (await submit(entry.id, entry.version, entry, true))
                  setRemoved({ ...entry, version: entry.version + 1 });
              }}
            >
              {text("删除提醒", "Delete reminder")}
            </Button>
          </article>
        ))}
      {removed && (
        <div role="status">
          {text("提醒已删除", "Reminder deleted")}
          <Button
            disabled={pending}
            onClick={async () => {
              if (await submit(removed.id, removed.version, removed))
                setRemoved(null);
            }}
          >
            {text("撤销", "Undo")}
          </Button>
        </div>
      )}
      {!hideCreate && (
        <Button onClick={beginCreate}>
          {text("添加提醒", "Add reminder")}
        </Button>
      )}
      {draft && (
        <Dialog
          aria-label={text("提醒", "Reminder")}
          onRequestClose={() => {
            if (!pending) setDraft(null);
          }}
        >
          <form
            onSubmit={async (event) => {
              event.preventDefault();
              if (
                await submit(editing?.id ?? null, editing?.version ?? 0, draft)
              )
                setDraft(null);
            }}
          >
            <h2>{text("提醒", "Reminder")}</h2>
            <label>
              {text("标题", "Title")}
              <input
                required
                maxLength={240}
                value={draft.title}
                onChange={(event) =>
                  setDraft({ ...draft, title: event.target.value })
                }
              />
            </label>
            <label>
              {text("内容", "Body")}
              <textarea
                value={draft.bodyMd}
                onChange={(event) =>
                  setDraft({ ...draft, bodyMd: event.target.value })
                }
              />
            </label>
            <DateField
              value={draft.day}
              required
              onChange={(day) => setDraft({ ...draft, day })}
            />
            <label>
              <input
                type="checkbox"
                checked={!draft.time}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    time: event.target.checked ? null : "09:00",
                    notifyMode: event.target.checked
                      ? "NONE"
                      : draft.notifyMode,
                    notifyOffsetMinutes: event.target.checked
                      ? null
                      : draft.notifyOffsetMinutes,
                  })
                }
              />
              {text("全天", "All day")}
            </label>
            <label>
              {text("时间", "Time")}
              <input
                type="time"
                value={draft.time ?? ""}
                onChange={(event) =>
                  setDraft({ ...draft, time: event.target.value || null })
                }
              />
            </label>
            <label>
              {text("通知", "Notification")}
              <Select
                aria-label={text("通知", "Notification")}
                value={draft.notifyMode}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    notifyMode: event.target
                      .value as ReminderInput["notifyMode"],
                    notifyOffsetMinutes:
                      event.target.value === "MINUTES_BEFORE" ? 15 : null,
                  })
                }
              >
                <option value="NONE">{text("不通知", "None")}</option>
                <option value="AT_TIME" disabled={!draft.time}>
                  {text("准时", "At time")}
                </option>
                <option value="MINUTES_BEFORE" disabled={!draft.time}>
                  {text("提前通知", "Minutes before")}
                </option>
              </Select>
            </label>
            {draft.notifyMode === "MINUTES_BEFORE" && (
              <label>
                {text("提前分钟", "Minutes before")}
                <input
                  type="number"
                  min={1}
                  max={43200}
                  required
                  value={draft.notifyOffsetMinutes ?? 15}
                  onChange={(event) =>
                    setDraft({
                      ...draft,
                      notifyOffsetMinutes: Number(event.target.value),
                    })
                  }
                />
              </label>
            )}
            <div className="field">
              <span>{text("关联项目", "Linked project")}</span>
              <ProjectDrilldownPicker
                mode="single"
                projects={items.filter(
                  (item) => item.type === "PROJECT" && !item.deletedAt,
                )}
                value={draft.linkedProjectId}
                onChange={(value) =>
                  setDraft({
                    ...draft,
                    linkedProjectId: typeof value === "string" ? value : null,
                  })
                }
              />
            </div>
            <TaskEntityPicker
              label={text("关联任务", "Linked task")}
              items={items}
              mode="single"
              disabled={pending}
              values={draft.linkedTaskId ? [draft.linkedTaskId] : []}
              onChange={(values) =>
                setDraft({ ...draft, linkedTaskId: values[0] ?? null })
              }
            />
            <small>{draft.timezone}</small>
            <Button
              type="submit"
              pending={pending}
              disabled={draft.notifyMode !== "NONE" && !draft.time}
            >
              {text("保存", "Save")}
            </Button>
            <Button disabled={pending} onClick={() => setDraft(null)}>
              {text("取消", "Cancel")}
            </Button>
          </form>
        </Dialog>
      )}
    </div>
  );
}
