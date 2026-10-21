import type { WorkspaceImportSummary } from "@arclattice/application";
import { useEffect, useState } from "react";
import type { Runtime } from "../bootstrap";
import { Button } from "../components/ui/Button";

/** Recovery is explicit; mounting this catalogue never resumes a remote mutation. */
export function WorkspaceImportRecovery({
  runtime,
  zh,
  revision,
  confirmLeave,
}: {
  runtime: Runtime;
  zh: boolean;
  revision: number;
  confirmLeave(): Promise<boolean>;
}) {
  const [review, setReview] = useState<Awaited<
    ReturnType<Runtime["previewImportedWorkspace"]>
  > | null>(null);
  const [rebaseReview, setRebaseReview] = useState<Awaited<
    ReturnType<Runtime["reviewWorkspaceImportChanges"]>
  > | null>(null);
  const [rows, setRows] = useState<readonly WorkspaceImportSummary[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [readFailed, setReadFailed] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [decisions, setDecisions] = useState<
    Record<string, "LOCAL" | "REMOTE">
  >({});
  const unresolved =
    rebaseReview?.conflicts.some(
      (conflict) =>
        !decisions[conflict.stepId] ||
        !rebaseReview.candidates.some(
          (entry) => entry.stepId === conflict.stepId,
        ),
    ) ?? false;
  useEffect(() => {
    let active = true;
    void runtime.listWorkspaceImports().then(
      (entries) => {
        if (active) {
          setRows(entries);
          setReadFailed(false);
        }
      },
      () => {
        if (active) setReadFailed(true);
      },
    );
    return () => {
      active = false;
    };
  }, [runtime, revision, refresh]);
  if (!rows.length && !failed && !readFailed) return null;
  return (
    <section aria-label={zh ? "导入恢复" : "Import recovery"}>
      <h3>{zh ? "导入记录" : "Imports"}</h3>
      {(failed || readFailed) && (
        <p role="alert">
          {zh
            ? "导入未能继续。请确认登录账户、目标工作区和原始内容未变化。备份与已完成记录仍保留；目标有变化时需重新审查。"
            : "Import could not continue. Check the account, destination and original content. Backups and completed steps remain intact; destination changes require a new review."}
        </p>
      )}
      {rebaseReview && (
        <section aria-label={zh ? "重新审查导入" : "Review import changes"}>
          <h4>{zh ? "目标工作区的最新内容" : "Current destination content"}</h4>
          <p>
            {zh ? "任务" : "Tasks"}: {rebaseReview.preview.counts.remote.tasks}{" "}
            · {zh ? "项目" : "Projects"}:{" "}
            {rebaseReview.preview.counts.remote.projects} ·{" "}
            {zh ? "文件" : "Files"}: {rebaseReview.preview.counts.remote.files}
          </p>
          <p>
            {zh ? "待完成操作" : "Remaining operations"}:{" "}
            {rebaseReview.remainingSteps}
          </p>
          {rebaseReview.conflicts.length > 0 && (
            <p role="alert">
              {zh
                ? "相关内容也有修改，需要逐项解决后才能继续。原始记录和备份保持保留。"
                : "Related content also changed and needs individual resolution before continuing. Original records and backups remain intact."}{" "}
              ({rebaseReview.conflicts.length})
            </p>
          )}
          {rebaseReview.candidates.map((candidate) => (
            <fieldset key={candidate.stepId} disabled={busy !== null}>
              <legend>
                {candidate.remote.collection === "manualOrders"
                  ? zh
                    ? "手动排序"
                    : "Manual order"
                  : candidate.remote.collection === "entityMemos"
                    ? zh
                      ? "私人备忘"
                      : "Private memo"
                    : candidate.title}
              </legend>
              {candidate.fields.map((field) =>
                field.field === "bodyMd" ? (
                  <section key={field.field}>
                    <h5>{zh ? "备忘正文" : "Memo text"}</h5>
                    <dl>
                      {[
                        [zh ? "本机" : "On this device", field.local],
                        [zh ? "目标" : "Destination", field.remote],
                      ].map(([label, value]) => (
                        <div key={String(label)}>
                          <dt>{String(label)}</dt>
                          <dd
                            style={{
                              whiteSpace: "pre-wrap",
                              overflowWrap: "anywhere",
                              maxHeight: "12rem",
                              overflow: "auto",
                            }}
                          >
                            {String(value)}
                          </dd>
                        </div>
                      ))}
                    </dl>
                  </section>
                ) : (
                  <p key={field.field}>
                    {reviewWord(field.field, zh)}: {zh ? "本机" : "Local"}{" "}
                    {reviewWord(String(field.local), zh)} ·{" "}
                    {zh ? "目标" : "Destination"}{" "}
                    {reviewWord(String(field.remote), zh)}
                  </p>
                ),
              )}
              <Button
                variant="secondary"
                aria-pressed={decisions[candidate.stepId] === "LOCAL"}
                onClick={() =>
                  setDecisions((value) => ({
                    ...value,
                    [candidate.stepId]: "LOCAL",
                  }))
                }
              >
                {candidate.remote.collection === "entityMemos"
                  ? zh
                    ? "保留本机正文"
                    : "Keep device text"
                  : zh
                    ? "使用本机设置"
                    : "Use local settings"}
              </Button>
              <Button
                variant="secondary"
                aria-pressed={decisions[candidate.stepId] === "REMOTE"}
                onClick={() =>
                  setDecisions((value) => ({
                    ...value,
                    [candidate.stepId]: "REMOTE",
                  }))
                }
              >
                {candidate.remote.collection === "entityMemos"
                  ? zh
                    ? "保留目标正文"
                    : "Keep destination text"
                  : zh
                    ? "保留目标设置"
                    : "Keep destination settings"}
              </Button>
            </fieldset>
          ))}
          {!rebaseReview.needsRebase && rebaseReview.remainingSteps > 0 && (
            <p>
              {zh
                ? "目标未发生额外变化，可继续原导入。"
                : "No additional destination changes; resume the original import."}
            </p>
          )}
          {rebaseReview.remainingSteps === 0 && (
            <p role="status">
              {zh
                ? "已从持久回执恢复全部进度。"
                : "All progress recovered from durable receipts."}
            </p>
          )}
          {rebaseReview.needsRebase && rebaseReview.remainingSteps > 0 && (
            <>
              <p>
                {zh
                  ? "将保存一份新备份，并以此预览重新准备尚未完成的操作。已完成内容和原导入记录继续保留。准备不会自动执行。"
                  : "Save a fresh backup and prepare only unfinished operations against this review. Completed content and the original import record remain intact. Preparation does not apply changes."}
              </p>
              <Button
                variant="secondary"
                pending={busy === "rebase"}
                disabled={busy !== null || unresolved}
                onClick={async () => {
                  setBusy("rebase");
                  setFailed(false);
                  try {
                    await runtime.prepareWorkspaceImportRebase({
                      ...rebaseReview,
                      resolutions: rebaseReview.candidates.flatMap((entry) =>
                        decisions[entry.stepId]
                          ? [
                              {
                                stepId: entry.stepId,
                                remote: entry.remote,
                                choice: decisions[entry.stepId]!,
                              },
                            ]
                          : [],
                      ),
                    });
                    setRebaseReview(null);
                  } catch {
                    setFailed(true);
                  } finally {
                    setBusy(null);
                    setRefresh((value) => value + 1);
                  }
                }}
              >
                {zh
                  ? "确认新预览并准备剩余操作"
                  : "Accept review and prepare remaining operations"}
              </Button>
            </>
          )}
          <Button
            variant="ghost"
            disabled={busy !== null}
            onClick={() => setRebaseReview(null)}
          >
            {zh ? "关闭审查" : "Close review"}
          </Button>
        </section>
      )}
      {review && (
        <section
          aria-label={zh ? "导入后工作区预览" : "Imported workspace preview"}
        >
          <h4>{zh ? "准备打开目标工作区" : "Ready to open the destination"}</h4>
          <p>
            {zh ? "任务" : "Tasks"}: {review.preview.counts.remote.tasks} ·{" "}
            {zh ? "项目" : "Projects"}: {review.preview.counts.remote.projects}{" "}
            · {zh ? "文档" : "Documents"}:{" "}
            {review.preview.counts.remote.documents} · {zh ? "文件" : "Files"}:{" "}
            {review.preview.counts.remote.files}
          </p>
          {review.destinationChanged && (
            <p>
              {zh
                ? "导入完成后目标还有更新；上面的数量已包含这些内容。"
                : "The destination changed after import; the counts above include those updates."}
            </p>
          )}
          <p>
            {zh
              ? "将在独立本机副本中打开并启用同步。原工作区与备份继续保留。"
              : "Open a separate device replica with sync enabled. Your original workspace and backup remain available."}
          </p>
          <Button
            variant="primary"
            disabled={busy !== null}
            pending={busy === "open"}
            onClick={async () => {
              if (busy || !(await confirmLeave())) return;
              setBusy("open");
              setFailed(false);
              try {
                await runtime.openAccountWorkspace(review.preview);
                location.reload();
              } catch {
                setFailed(true);
                setBusy(null);
              }
            }}
          >
            {zh ? "打开导入后的工作区" : "Open imported workspace"}
          </Button>
          <Button
            variant="ghost"
            disabled={busy !== null}
            onClick={() => setReview(null)}
          >
            {zh ? "保留当前工作区" : "Stay in this workspace"}
          </Button>
        </section>
      )}
      {rows.map((row) => (
        <div key={row.id}>
          <p>
            {row.complete
              ? zh
                ? "内容已导入"
                : "Content imported"
              : zh
                ? "导入尚未结束"
                : "Import not finished"}
            {` · ${row.completedSteps} / ${row.totalSteps}`}
          </p>
          <details>
            <summary>{zh ? "目标与备份" : "Destination and backup"}</summary>
            <p>
              {row.targetOrigin} · {row.targetWorkspaceId}
            </p>
            <p>{row.backupId}</p>
          </details>
          {row.complete && (
            <Button
              variant="secondary"
              disabled={busy !== null}
              pending={busy === row.id}
              onClick={async () => {
                setBusy(row.id);
                setFailed(false);
                setReview(null);
                try {
                  setReview(await runtime.previewImportedWorkspace(row.id));
                } catch {
                  setFailed(true);
                } finally {
                  setBusy(null);
                }
              }}
            >
              {zh ? "查看导入后的工作区" : "Review imported workspace"}
            </Button>
          )}
          {row.supersededBy && (
            <p>
              {zh
                ? "已由新的审查记录继续，原记录仍保留。"
                : "Continued by a new review; this original record is retained."}
            </p>
          )}
          {!row.complete && !row.supersededBy && (
            <Button
              variant="ghost"
              pending={busy === "review:" + row.id}
              disabled={busy !== null}
              onClick={async () => {
                setBusy("review:" + row.id);
                setFailed(false);
                setReview(null);
                setRebaseReview(null);
                setDecisions({});
                try {
                  setRebaseReview(
                    await runtime.reviewWorkspaceImportChanges(row.id),
                  );
                } catch {
                  setFailed(true);
                } finally {
                  setBusy(null);
                  setRefresh((value) => value + 1);
                }
              }}
            >
              {zh ? "检查目标变化" : "Review destination changes"}
            </Button>
          )}
          {!row.complete && !row.supersededBy && (
            <Button
              variant="secondary"
              pending={busy === row.id}
              disabled={busy !== null}
              onClick={async () => {
                if (busy) return;
                setBusy(row.id);
                setFailed(false);
                try {
                  await runtime.continueWorkspaceImport(row.id);
                } catch {
                  setFailed(true);
                } finally {
                  setBusy(null);
                  setRefresh((value) => value + 1);
                }
              }}
            >
              {zh ? "继续此导入" : "Resume this import"}
            </Button>
          )}
        </div>
      ))}
    </section>
  );
}

function reviewWord(value: string, zh: boolean) {
  const labels: Record<string, [string, string]> = {
    status: ["状态", "Status"],
    activationState: ["激活状态", "Activation"],
    activationPolicy: ["激活方式", "Activation policy"],
    projectLifecycle: ["项目阶段", "Project stage"],
    name: ["名称", "Name"],
    order: ["排列顺序", "Order"],
    TODO: ["待办", "To do"],
    IN_PROGRESS: ["进行中", "In progress"],
    DONE: ["已完成", "Done"],
    CANCELED: ["已取消", "Canceled"],
    ACTIVE: ["现在", "Now"],
    INACTIVE: ["稍后", "Later"],
    SCHEDULED: ["已计划", "Scheduled"],
    MANUAL: ["手动", "Manual"],
    IMMEDIATE: ["立即", "Immediately"],
    WHEN_DEPENDENCIES_COMPLETED: ["前置完成后", "After prerequisites"],
    AT_SCHEDULED_TIME: ["指定时间", "At scheduled time"],
    PLANNED: ["计划中", "Planned"],
    COMPLETED: ["已完成", "Completed"],
    PAUSED: ["暂停", "Paused"],
    ARCHIVED: ["已归档", "Archived"],
  };
  return labels[value]?.[zh ? 0 : 1] ?? value;
}
