import type { AgentRun } from "@arclattice/application";
import { useState } from "react";
import type { Runtime } from "../../bootstrap";
import { Button } from "../../components/ui/Button";

const names: Record<string, [string, string]> = {
  search_documents: ["搜索文档", "Search documents"],
  read_document: ["读取文档", "Read document"],
  get_project: ["读取项目", "Read project"],
  list_project_tasks: ["读取项目任务", "Read project tasks"],
  create_task: ["创建任务", "Create task"],
  update_task: ["更新任务", "Update task"],
  complete_task: ["完成任务", "Complete task"],
  reschedule_task: ["调整任务日期", "Reschedule task"],
  set_task_priority: ["调整优先级", "Set task priority"],
  move_task_to_project: ["移动任务", "Move task"],
  preview_plan: ["预览导入计划", "Preview import plan"],
  publish_plan: ["发布已审阅计划", "Publish reviewed plan"],
  create_document: ["创建文档", "Create document"],
  move_document: ["移动文档", "Move document"],
  propose_document_edit: ["建议文档修改", "Propose document edit"],
  link_documents: ["关联文档", "Link documents"],
};
function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
export function ToolDetails({ value, zh }: { value: unknown; zh: boolean }) {
  const row = record(value);
  if (!row) return <pre>{JSON.stringify(value, null, 2)}</pre>;
  if (typeof row.before === "string" && typeof row.after === "string")
    return (
      <div className="document-change-preview">
        <section>
          <h4>{zh ? "修改前" : "Before"}</h4>
          <pre>{row.before}</pre>
        </section>
        <section>
          <h4>{zh ? "修改后" : "After"}</h4>
          <pre>{row.after}</pre>
        </section>
      </div>
    );
  const manifest =
    record(row.manifest) ??
    (record(row.payload)?.kind === "PLAN" ? record(row.payload) : null);
  if (manifest && Array.isArray(manifest.tasks))
    return (
      <div>
        <p>
          {zh
            ? `计划包含 ${manifest.tasks.length} 个任务`
            : `Plan contains ${manifest.tasks.length} tasks`}
        </p>
        <ol>
          {manifest.tasks.map((task, index) => {
            const item = record(task);
            return (
              <li key={String(item?.tempId ?? index)}>
                {String(item?.title ?? "")}{" "}
                {typeof item?.dueDate === "string" ? item.dueDate : ""}
              </li>
            );
          })}
        </ol>
      </div>
    );
  return (
    <dl>
      {Object.entries(row).map(([key, field]) => (
        <div key={key}>
          <dt>{key}</dt>
          <dd>{typeof field === "string" ? field : JSON.stringify(field)}</dd>
        </div>
      ))}
    </dl>
  );
}
export function ToolActivity({ text, zh }: { text: string; zh: boolean }) {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return <pre>{text}</pre>;
  }
  const row = record(value);
  const name = typeof row?.name === "string" ? row.name : "";
  return (
    <div className="tool-activity">
      <h4>{names[name]?.[zh ? 0 : 1] ?? (zh ? "工具结果" : "Tool result")}</h4>
      <ToolDetails value={row?.output ?? row?.input ?? value} zh={zh} />
    </div>
  );
}
export function HarnessApproval({
  run,
  runtime,
  zh,
  busy,
  onDecision,
}: {
  run: AgentRun;
  runtime: Runtime;
  zh: boolean;
  busy: boolean;
  onDecision(action: () => Promise<AgentRun>): void;
}) {
  const call = run.harness?.pending[0];
  const plan =
    call?.name === "publish_plan"
      ? run.harness?.messages
          .filter(
            (message) =>
              message.role === "tool" && message.toolName === "preview_plan",
          )
          .map((message) => {
            try {
              return record(JSON.parse(message.text));
            } catch {
              return null;
            }
          })
          .find((row) => row?.id === record(call.input)?.id)
      : null;
  const payload = record(plan?.payload);
  const manifest = payload
    ? {
        version: 1,
        projects: payload.projects ?? [],
        tasks: payload.tasks ?? [],
        categories: payload.categories ?? [],
        recurrences: payload.recurrences ?? [],
        spaces: payload.spaces ?? [],
        documents: payload.documents ?? [],
      }
    : null;
  const [editing, setEditing] = useState(false),
    [draft, setDraft] = useState(() =>
      JSON.stringify(
        manifest ? { ...record(call?.input), manifest } : call?.input,
        null,
        2,
      ),
    );
  if (!call) return null;
  const editedInput = manifest ? record(JSON.parse(draft)) : null;
  const editedManifest = record(editedInput?.manifest);
  const editedTasks = Array.isArray(editedManifest?.tasks)
    ? editedManifest.tasks
    : [];
  return (
    <section
      className="approval-card"
      aria-label={zh ? "工具审批" : "Tool approval"}
    >
      <h3>
        {zh ? "Atlas 请求" : "Atlas requests"}{" "}
        {names[call.name]?.[zh ? 0 : 1] ?? call.name}
      </h3>
      <ToolDetails value={manifest ? { manifest } : call.input} zh={zh} />
      {editing && manifest && (
        <div className="plan-review-editor">
          {editedTasks.map((task, index) => (
            <label key={String(record(task)?.tempId ?? index)}>
              {zh ? `任务 ${index + 1}` : `Task ${index + 1}`}
              <input
                value={String(record(task)?.title ?? "")}
                onChange={(event) => {
                  setDraft(
                    JSON.stringify({
                      ...editedInput,
                      manifest: {
                        ...editedManifest,
                        tasks: editedTasks.map((row, rowIndex) =>
                          rowIndex === index
                            ? { ...record(row), title: event.target.value }
                            : row,
                        ),
                      },
                    }),
                  );
                }}
              />
            </label>
          ))}
        </div>
      )}
      {editing && !manifest && (
        <label>
          {zh ? "修改提案参数" : "Edit proposal arguments"}
          <textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
          />
        </label>
      )}
      <Button
        type="button"
        disabled={busy}
        onClick={() =>
          onDecision(async () =>
            runtime.decideHarness(
              run.id,
              run.version,
              call.id,
              true,
              editing ? JSON.parse(draft) : undefined,
            ),
          )
        }
      >
        {zh ? "批准" : "Approve"}
      </Button>
      <Button
        type="button"
        disabled={busy}
        onClick={() => setEditing((value) => !value)}
      >
        {zh ? "修改" : "Modify"}
      </Button>
      <Button
        type="button"
        disabled={busy}
        onClick={() =>
          onDecision(() =>
            runtime.decideHarness(run.id, run.version, call.id, false),
          )
        }
      >
        {zh ? "拒绝" : "Reject"}
      </Button>
    </section>
  );
}
