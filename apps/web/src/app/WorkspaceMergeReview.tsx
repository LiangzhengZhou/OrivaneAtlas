import type {
  WorkspaceConnectionPreview,
  WorkspaceMergeBackup,
} from "@arclattice/application";
import { useState } from "react";
import type { Runtime } from "../bootstrap";
import { Button } from "../components/ui/Button";

import { WorkspaceMergeChoices } from "./WorkspaceMergeChoices";

/** Metadata-only comparison; displaying this report never authorizes a write. */
export function WorkspaceMergeReview({
  preview,
  zh,
  runtime,
  onBackupSaved,
}: {
  preview: WorkspaceConnectionPreview;
  zh: boolean;
  runtime: Runtime;
  onBackupSaved(): void;
}) {
  const [backup, setBackup] = useState<WorkspaceMergeBackup | null>(null),
    [busy, setBusy] = useState(false),
    [failed, setFailed] = useState(false);
  const findings = [
    [
      zh ? "完全相同的内容" : "Exact duplicates",
      preview.exactDuplicates.length,
    ],
    [
      zh ? "可能重复的内容" : "Possible duplicates",
      preview.possibleDuplicates.length,
    ],
    [zh ? "标识冲突" : "ID collisions", preview.idCollisions.length],
    [
      zh ? "项目层级冲突" : "Project hierarchy conflicts",
      preview.projectHierarchyConflicts.length,
    ],
    [
      zh ? "任务所属项目冲突" : "Task membership conflicts",
      preview.taskMembershipConflicts.length,
    ],
    [
      zh ? "文档标题或别名冲突" : "Document title or alias collisions",
      preview.documentNameCollisions.length,
    ],
    [
      zh ? "相同的原始文件" : "Duplicate original files",
      preview.fileHashDuplicates.length,
    ],
  ] as const;
  return (
    <section aria-label={zh ? "合并预览" : "Merge preview"}>
      <h3>{zh ? "比较两个工作区" : "Compare workspaces"}</h3>
      <p>
        {zh
          ? "此预览不会更改任何内容。尚未加载正文的文档不会仅凭标题或长度被判定为完全相同。"
          : "This preview changes no content. Documents with unloaded bodies are never treated as exact duplicates based on title or length."}
      </p>
      <Button
        variant="secondary"
        pending={busy}
        disabled={backup !== null}
        onClick={async () => {
          if (busy) return;
          setBusy(true);
          setFailed(false);
          try {
            setBackup(await runtime.saveWorkspaceMergeBackup(preview));
            onBackupSaved();
          } catch {
            setFailed(true);
          } finally {
            setBusy(false);
          }
        }}
      >
        {zh ? "保存合并前备份" : "Save a backup before merging"}
      </Button>
      {failed && (
        <p role="alert">
          {zh
            ? "备份未能通过验证，请重新预览后重试。内容未合并。"
            : "Backup verification failed. Review again and retry. No content was merged."}
        </p>
      )}
      {backup && (
        <p role="status">
          {zh
            ? "原始内容与文件已备份在本机。"
            : "Original content and files are backed up on this device."}
        </p>
      )}
      {backup && (
        <WorkspaceMergeChoices
          runtime={runtime}
          preview={preview}
          backupId={backup.id}
          zh={zh}
          onChanged={onBackupSaved}
        />
      )}
      <dl>
        {findings.map(([label, count]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{count}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
