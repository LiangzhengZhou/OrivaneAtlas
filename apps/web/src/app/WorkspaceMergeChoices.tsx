import type {
  WorkspaceConnectionPreview,
  WorkspaceImportJournal,
  WorkspaceMergeChoice,
} from "@arclattice/application";
import { useEffect, useState } from "react";
import type { Runtime } from "../bootstrap";
import { Button } from "../components/ui/Button";
import { Select } from "../components/ui/Surfaces";

type Candidate = Awaited<
  ReturnType<Runtime["workspaceMergeCandidates"]>
>[number];
export function WorkspaceMergeChoices({
  runtime,
  preview,
  backupId,
  zh,
  onChanged,
}: {
  runtime: Runtime;
  preview: WorkspaceConnectionPreview;
  backupId: string;
  zh: boolean;
  onChanged(): void;
}) {
  const [rows, setRows] = useState<readonly Candidate[]>([]);
  const [choices, setChoices] = useState<Record<string, WorkspaceMergeChoice>>(
    {},
  );
  const [journal, setJournal] = useState<WorkspaceImportJournal | null>(null);
  const [busy, setBusy] = useState(false),
    [failed, setFailed] = useState(false);
  const [offset, setOffset] = useState(0);
  const collectionLabel = (collection: string) =>
    (
      ({
        items: zh ? "任务与项目" : "Tasks and projects",
        library: zh ? "知识库" : "Library",
        notes: zh ? "笔记与日记" : "Notes and journals",
        files: zh ? "文件" : "Files",
        entityMemos: zh ? "私人备忘" : "Private memos",
        categories: zh ? "分类" : "Categories",
        organization: zh ? "归档与文件夹" : "Archive and folders",
        manualOrders: zh ? "排列顺序" : "Order",
        projectMaterials: zh ? "项目资料" : "Project knowledge",
        links: zh ? "内容关联" : "Content links",
        edges: zh ? "任务关系" : "Task relationships",
        reminders: zh ? "提醒" : "Reminders",
        workflows: zh ? "重复与流程" : "Recurrence and workflows",
      }) as Record<string, string>
    )[collection] ?? (zh ? "关联内容" : "Related content");
  const key = (row: Candidate) =>
    JSON.stringify([row.collection, row.sourceId]);
  useEffect(() => {
    let active = true;
    void runtime.workspaceMergeCandidates(preview).then(
      (result) => {
        if (active) {
          setRows(result);
          setFailed(false);
        }
      },
      () => {
        if (active) setFailed(true);
      },
    );
    return () => {
      active = false;
    };
  }, [runtime, preview]);
  return (
    <section aria-label={zh ? "选择合并内容" : "Choose content to merge"}>
      <h4>{zh ? "逐项决定如何处理" : "Choose how to handle each item"}</h4>
      {failed && (
        <p role="alert">
          {zh
            ? "无法准备或继续导入。请重新比较工作区；备份与原始内容仍保留。"
            : "Import could not be prepared or continued. Compare workspaces again; backups and original content remain intact."}
        </p>
      )}
      {!journal && (
        <>
          <p>
            {zh
              ? "复制会创建新内容，不覆盖账户中的现有内容。关联内容必须一并复制或选择已确认相同的账户内容。"
              : "Copy creates new content without replacing account content. Include related items or reuse confirmed identical account content."}
          </p>
          <Button
            variant="ghost"
            disabled={busy || !rows.length}
            onClick={() =>
              setChoices(
                Object.fromEntries(
                  rows.map((row) => [
                    key(row),
                    {
                      collection: row.collection,
                      sourceId: row.sourceId,
                      action: "COPY",
                    },
                  ]),
                ),
              )
            }
          >
            {zh ? "全部选择复制" : "Choose copy for all"}
          </Button>
          {rows.slice(offset, offset + 50).map((row) => (
            <label key={key(row)} className="settings-row">
              <span>
                {row.title} <small>{collectionLabel(row.collection)}</small>
              </span>
              <Select
                disabled={busy}
                aria-label={(zh ? "处理：" : "Handle: ") + row.title}
                value={
                  choices[key(row)]?.action === "USE_REMOTE"
                    ? "REMOTE:" +
                      (
                        choices[key(row)] as Extract<
                          WorkspaceMergeChoice,
                          { action: "USE_REMOTE" }
                        >
                      ).targetId
                    : (choices[key(row)]?.action ?? "")
                }
                onChange={(event) => {
                  const value = event.target.value;
                  setChoices((current) => {
                    const next = { ...current };
                    if (!value) delete next[key(row)];
                    else
                      next[key(row)] = {
                        collection: row.collection,
                        sourceId: row.sourceId,
                        ...(value.startsWith("REMOTE:")
                          ? ({
                              action: "USE_REMOTE",
                              targetId: value.slice(7),
                            } as const)
                          : { action: value as "COPY" | "SKIP" }),
                      };
                    return next;
                  });
                }}
              >
                <option value="">{zh ? "请选择" : "Choose"}</option>
                <option value="COPY">
                  {zh ? "复制到目标" : "Copy to destination"}
                </option>
                <option value="SKIP">
                  {zh ? "保留本机，不导入" : "Keep local; do not import"}
                </option>
                {row.remoteIds.map((id) => (
                  <option key={id} value={"REMOTE:" + id}>
                    {zh
                      ? "使用相同账户内容"
                      : "Reuse identical account content"}{" "}
                    · {id}
                  </option>
                ))}
              </Select>
            </label>
          ))}
          {rows.length > 50 && (
            <div className="ui-toolbar">
              <Button
                disabled={busy || offset === 0}
                onClick={() => setOffset((value) => Math.max(0, value - 50))}
              >
                {zh ? "上一页" : "Previous"}
              </Button>
              <span>
                {Math.floor(offset / 50) + 1} / {Math.ceil(rows.length / 50)}
              </span>
              <Button
                disabled={busy || offset + 50 >= rows.length}
                onClick={() => setOffset((value) => value + 50)}
              >
                {zh ? "下一页" : "Next"}
              </Button>
            </div>
          )}
          <Button
            variant="secondary"
            pending={busy}
            disabled={
              busy ||
              !rows.length ||
              Object.keys(choices).length !== rows.length
            }
            onClick={async () => {
              setBusy(true);
              setFailed(false);
              try {
                const result = await runtime.prepareWorkspaceMergeImport(
                  backupId,
                  Object.values(choices),
                );
                setJournal(result.journal);
                onChanged();
              } catch {
                setFailed(true);
              } finally {
                setBusy(false);
              }
            }}
          >
            {zh ? "生成导入预览" : "Prepare import preview"}
          </Button>
        </>
      )}
      {journal && (
        <>
          <dl>
            {Object.entries(
              rows.reduce<Record<string, number>>((counts, row) => {
                if (choices[key(row)]?.action === "COPY")
                  counts[row.collection] = (counts[row.collection] ?? 0) + 1;
                return counts;
              }, {}),
            ).map(([collection, count]) => (
              <div key={collection}>
                <dt>{collectionLabel(collection)}</dt>
                <dd>{count}</dd>
              </div>
            ))}
          </dl>
          <p>
            {zh ? "已准备的操作" : "Prepared operations"}:{" "}
            {journal.steps.length} · {zh ? "已完成" : "Completed"}:{" "}
            {journal.accepted.length}
          </p>
          <p>
            {zh
              ? "执行只增加目标内容，不切换当前工作区。中断后可从导入记录继续。"
              : "Apply adds destination content without switching this workspace. Interrupted imports can resume from Imports."}
          </p>
          {journal.accepted.length < journal.steps.length && (
            <Button
              variant="primary"
              pending={busy}
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                setFailed(false);
                try {
                  setJournal(await runtime.continueWorkspaceImport(journal.id));
                } catch {
                  setFailed(true);
                } finally {
                  setBusy(false);
                  onChanged();
                }
              }}
            >
              {zh ? "确认并导入" : "Confirm and import"}
            </Button>
          )}
          {journal.accepted.length === journal.steps.length && (
            <p role="status">
              {zh
                ? "所选内容已导入。当前本机工作区与备份保持保留。"
                : "Selected content imported. This device workspace and its backup remain available."}
            </p>
          )}
        </>
      )}
    </section>
  );
}
