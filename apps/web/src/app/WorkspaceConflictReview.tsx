import {
  equalLocalJson,
  type LocalJson,
  type LocalWorkConflictReview,
  localObject,
} from "@arclattice/application";
import { useEffect, useState } from "react";
import type { Runtime } from "../bootstrap";
import { Button } from "../components/ui/Button";
import { DismissibleDialog } from "./DismissibleDialog";
import "./workspace-conflict-review.css";

export function WorkspaceConflictReview({
  runtime,
  zh,
}: {
  runtime: Runtime;
  zh: boolean;
}) {
  const [reviews, setReviews] = useState<LocalWorkConflictReview[]>([]);
  const [selected, setSelected] = useState<LocalWorkConflictReview | null>(
    null,
  );
  const [choice, setChoice] = useState<
    "LOCAL" | "REMOTE" | "RESTORE" | "COPY" | null
  >(null);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    let active = true,
      sequence = 0;
    const load = () => {
      const request = ++sequence;
      void runtime.localWorkConflicts().then(
        (rows) => {
          if (active && request === sequence) setReviews(rows);
        },
        () => {
          if (active && request === sequence)
            setError(
              zh ? "无法读取待处理的冲突。" : "Could not load conflicts.",
            );
        },
      );
    };
    load();
    const stop = runtime.subscribeWorkspace(load);
    return () => {
      active = false;
      stop();
    };
  }, [runtime, zh]);
  if (!reviews.length && !selected && !error) return null;
  const commandInput = selected
    ? localObject(localObject(selected.originalCommand.value).input!)
    : {};
  const patch =
    selected?.original.entityType === "entityMemos"
      ? {
          bodyMd: localObject(commandInput.input!).bodyMd!,
          deletedAt: localObject(selected.original.payload).deletedAt!,
        }
      : selected?.original.entityType === "files"
        ? { name: commandInput.name! }
        : selected
          ? localObject(
              localObject(localObject(selected.originalCommand.value).input!)
                .input!,
            )
          : {};
  const base = selected?.original.basePayload
    ? localObject(selected.original.basePayload)
    : {};
  const remoteValue = selected
    ? localObject(selected.remoteBase.value).value
    : undefined;
  const purgedMemo =
    selected?.original.entityType === "entityMemos" && remoteValue === null;
  const local = selected
    ? localObject(
        purgedMemo
          ? (selected.followers?.at(-1)?.payload ?? selected.original.payload)
          : selected.followers?.length ||
              ["notes", "library"].includes(selected.original.entityType)
            ? selected.original.payload
            : selected.current.value,
      )
    : {};
  const remote =
    remoteValue === null || remoteValue === undefined
      ? {}
      : localObject(remoteValue);
  const localDeletedMemo =
    selected?.original.entityType === "entityMemos" &&
    commandInput.deleted === true;
  const deletedKnowledge =
    !!selected &&
    ["notes", "library"].includes(selected.original.entityType) &&
    typeof remote.deletedAt === "string";
  const deletedMemo =
    selected?.original.entityType === "entityMemos" &&
    typeof remote.deletedAt === "string";
  const fieldLabel = (key: string) =>
    ({
      title: zh ? "标题" : "Title",
      name: zh ? "文件名" : "File name",
      descriptionMd: zh ? "内容" : "Content",
      bodyMd: zh ? "正文" : "Markdown",
      deletedAt: zh ? "删除时间" : "Deleted at",
      aliases: zh ? "别名" : "Aliases",
      spaceId: zh ? "知识空间" : "Knowledge space",
      parentDocumentId: zh ? "上级文档" : "Parent document",
      aiPolicy: zh ? "内容隐私" : "Content privacy",
      priority: zh ? "优先级" : "Priority",
      startDate: zh ? "开始日期" : "Start date",
      dueDate: zh ? "截止日期" : "Due date",
      parentProjectId: zh ? "上级项目" : "Parent project",
      projectIds: zh ? "所属项目" : "Projects",
      categoryId: zh ? "分类" : "Category",
      assigneePrincipalId: zh ? "负责人" : "Assignee",
      activationState: zh ? "激活状态" : "Activation",
      activationPolicy: zh ? "激活方式" : "Activation policy",
    })[key] ?? (zh ? "变更字段" : "Changed field");
  const text = (value: LocalJson | undefined) =>
    value === null || value === undefined
      ? "—"
      : typeof value === "string"
        ? value
        : JSON.stringify(value);
  return (
    <section aria-label={zh ? "同步冲突" : "Sync conflicts"}>
      <h3>{zh ? "需要比较的修改" : "Changes to compare"}</h3>
      {error && <p role="alert">{error}</p>}
      {reviews.map((review) => (
        <Button
          key={review.original.id}
          variant="ghost"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setChoice(null);
            setError("");
            try {
              setSelected(await runtime.openLocalWorkConflict(review));
            } catch {
              setError(
                zh
                  ? "内容已经变化，请重新打开比较。"
                  : "Content changed; reopen the comparison.",
              );
            } finally {
              setBusy(false);
            }
          }}
        >
          {text(
            localObject(review.current.value).title ??
              localObject(review.current.value).name,
          )}{" "}
          · {zh ? "比较修改" : "Compare changes"}
        </Button>
      ))}
      {selected && (
        <DismissibleDialog
          className="ui-dialog workspace-conflict-review"
          aria-label={zh ? "比较同步修改" : "Compare synced changes"}
          onRequestClose={() => {
            if (!busy) setSelected(null);
          }}
        >
          <h2>{zh ? "选择要保留的修改" : "Choose which changes to keep"}</h2>
          <p>
            {zh
              ? "两边都保留原始记录。若比较期间内容变化，请重新打开比较。"
              : "Original records are retained. If content changes during review, reopen the comparison."}
          </p>
          {!!selected.followers?.length && !purgedMemo && (
            <p>
              {zh
                ? "先处理较早的冲突。之后的本机修改会继续保留，并按顺序同步或再次比较。"
                : "Resolve the earlier conflict first. Later device edits remain saved and will sync or be reviewed in order."}
            </p>
          )}
          {purgedMemo && !!selected.followers?.length && (
            <details>
              <summary>
                {zh
                  ? "同时保留这些后续本机修改的记录"
                  : "Retain evidence of these later device changes too"}
              </summary>
              {selected.followers.map((entry) => (
                <pre className="entity-memo-review" key={entry.id}>
                  {text(localObject(entry.payload).bodyMd)}
                </pre>
              ))}
            </details>
          )}
          {Object.keys(patch)
            .filter(
              (field) =>
                !equalLocalJson(base[field] ?? null, local[field] ?? null),
            )
            .map((field) => (
              <section key={field}>
                <h3>{fieldLabel(field)}</h3>
                <dl>
                  {[
                    [zh ? "修改前" : "Base", base[field]],
                    [zh ? "本机" : "On this device", local[field]],
                    [zh ? "远端" : "Remote", remote[field]],
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
                        {text(value as LocalJson | undefined)}
                      </dd>
                    </div>
                  ))}
                </dl>
              </section>
            ))}
          <fieldset disabled={busy}>
            <legend>
              {zh ? "应用到以上字段" : "Apply to the fields above"}
            </legend>
            {deletedKnowledge && (
              <p>
                {zh
                  ? "远端已删除此文档。本机正文仍保留，请明确选择处理方式。"
                  : "This document was deleted remotely. Your device text is retained; choose how to proceed."}
              </p>
            )}
            {deletedMemo && (
              <p>
                {zh
                  ? "远端已删除此备忘。本机正文仍保留；请选择恢复正文或接受删除。"
                  : "This memo was deleted remotely. Device text is retained; restore it or accept the deletion."}
              </p>
            )}
            {purgedMemo && (
              <p>
                {zh
                  ? "远端已永久删除此备忘或其所属内容，无法直接恢复。接受删除后，本机原始修改仍作为冲突记录保留。"
                  : "The memo or its target was permanently removed remotely and cannot be restored here. Accepting deletion retains your original device changes as conflict evidence."}
              </p>
            )}
            {localDeletedMemo && (
              <p>
                {zh
                  ? "本机已删除此备忘，远端内容发生了变化。请选择保留删除或使用远端版本。"
                  : "This memo was deleted on your device and changed remotely. Keep the deletion or use the remote version."}
              </p>
            )}
            <label>
              <input
                type="radio"
                name="conflict-choice"
                disabled={purgedMemo}
                checked={choice === (deletedKnowledge ? "RESTORE" : "LOCAL")}
                onChange={() =>
                  setChoice(deletedKnowledge ? "RESTORE" : "LOCAL")
                }
              />
              {localDeletedMemo
                ? zh
                  ? "保留本机删除"
                  : "Keep device deletion"
                : deletedMemo
                  ? zh
                    ? "恢复并保留本机正文"
                    : "Restore and keep device text"
                  : deletedKnowledge
                    ? zh
                      ? "恢复并保留本机版本"
                      : "Restore and keep device version"
                    : zh
                      ? "保留本机修改"
                      : "Keep device changes"}
            </label>
            <label>
              <input
                type="radio"
                name="conflict-choice"
                checked={choice === "REMOTE"}
                onChange={() => setChoice("REMOTE")}
              />
              {deletedMemo || purgedMemo
                ? zh
                  ? "接受远端删除"
                  : "Accept remote deletion"
                : deletedKnowledge
                  ? zh
                    ? "接受远端删除"
                    : "Accept remote deletion"
                  : zh
                    ? "使用远端内容"
                    : "Use remote values"}
            </label>
            {deletedKnowledge && (
              <label>
                <input
                  type="radio"
                  name="conflict-choice"
                  checked={choice === "COPY"}
                  onChange={() => setChoice("COPY")}
                />
                {zh ? "另存为新文档" : "Save as a new document"}
              </label>
            )}
          </fieldset>
          {error && <p role="alert">{error}</p>}
          <div className="actions">
            <Button
              variant="primary"
              disabled={!choice || busy}
              pending={busy}
              onClick={async () => {
                if (!choice || busy) return;
                setBusy(true);
                setError("");
                try {
                  if (deletedKnowledge || purgedMemo) {
                    if (choice === "LOCAL") return;
                    await runtime.resolveDeletedKnowledgeConflict(
                      selected,
                      choice,
                    );
                  } else {
                    if (choice !== "LOCAL" && choice !== "REMOTE") return;
                    await runtime.resolveLocalWorkConflict(selected, choice);
                  }
                  setSelected(null);
                  setChoice(null);
                  setReviews(await runtime.localWorkConflicts());
                } catch {
                  setError(
                    zh
                      ? "内容或同步状态已变化。请关闭并重新比较；原始修改仍保留。"
                      : "Content or sync state changed. Close and compare again; original changes are retained.",
                  );
                } finally {
                  setBusy(false);
                }
              }}
            >
              {zh ? "应用选择" : "Apply choice"}
            </Button>
            <Button
              variant="ghost"
              disabled={busy}
              onClick={() => setSelected(null)}
            >
              {zh ? "取消" : "Cancel"}
            </Button>
          </div>
        </DismissibleDialog>
      )}
    </section>
  );
}
