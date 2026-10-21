import {
  type ContentPolicy,
  type FileProcessingRecord,
  fileExtractionLimits,
  scopedKnowledgeDocuments,
  type WorkspaceLibraryEntry,
} from "@arclattice/application";
import {
  type FileExtractionDocument,
  fileReadTier,
  type LibraryFile,
} from "@arclattice/domain";
import { Download, X } from "lucide-react";
import { useEffect, useId, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { showToast } from "../../app/ToastHost";
import type { Runtime, Snapshot } from "../../bootstrap";
import { ContentPolicyEditor } from "../../ContentPolicyEditor";
import { Button, IconButton } from "../../components/ui/Button";
import { confirmAction } from "../../components/ui/ConfirmationHost";
import { EntityMenu } from "../../components/ui/EntityMenu";
import { projectHash } from "../../projectRoute";
import { HierarchyPicker } from "../hierarchy/HierarchyPicker";
import { ProjectDrilldownPicker } from "../projects/ProjectDrilldownPicker";
import { VirtualTaskCollection } from "../tasks/VirtualTaskCollection";
import "./files.css";
import { EntityMemo } from "../memos/EntityMemo";
import { type FileAtlasDraft, FileAtlasFloat } from "./FileAtlasFloat";
import { safeFileFailureCode } from "./fileFailure";
import { fileMarkdownLink } from "./fileRoute";

export type FileDraft = { name: string; policy: ContentPolicy };

export function FileDetail({
  file,
  snapshot,
  runtime,
  onChanged,
  onClose,
  onOpenDocument,
  draft,
  onStatus,
  atlasDraft,
  onAtlasDraft,
}: {
  file: LibraryFile;
  snapshot: Snapshot;
  runtime: Runtime;
  onChanged(): Promise<void>;
  onClose(): void;
  onOpenDocument(document: WorkspaceLibraryEntry): void;
  draft?: FileDraft | undefined;
  onStatus?(draft: FileDraft, dirty: boolean, busy: boolean): void;
  atlasDraft?: FileAtlasDraft | undefined;
  onAtlasDraft?(draft: FileAtlasDraft): void;
}) {
  const { i18n } = useTranslation(),
    zh = i18n.language.startsWith("zh"),
    titleId = useId();
  const [name, setName] = useState(draft?.name ?? file.name),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [preview, setPreview] = useState<FileExtractionDocument | null>(null);
  const [processing, setProcessing] = useState<FileProcessingRecord | null>(
    null,
  );
  const [previewAttempt, setPreviewAttempt] = useState(0);
  const [atlasOpen, setAtlasOpen] = useState(false);
  const [policy, setPolicy] = useState<ContentPolicy>(
    draft?.policy ?? file.aiPolicy,
  );
  const policyDirty =
    policy.aiAccess !== file.aiPolicy.aiAccess ||
    policy.classification !== file.aiPolicy.classification ||
    policy.processingBoundary !== file.aiPolicy.processingBoundary;
  useEffect(() => {
    onStatus?.({ name, policy }, name !== file.name || policyDirty, busy);
  }, [name, policy, file.name, policyDirty, busy, onStatus]);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [documentId, setDocumentId] = useState<string | null>(null);
  const documents = useMemo(
    () =>
      scopedKnowledgeDocuments({
        items: snapshot.items,
        projectMaterials: snapshot.projectMaterials,
        library: snapshot.library,
        workspaceId: file.workspaceId,
      }),
    [
      snapshot.items,
      snapshot.projectMaterials,
      snapshot.library,
      file.workspaceId,
    ],
  );
  const documentById = useMemo(
    () => new Map(documents.map((document) => [document.id, document])),
    [documents],
  );
  const documentEntries = useMemo(
    () => [
      ...snapshot.library
        .filter(
          (entry) =>
            entry.kind === "SPACE" &&
            !entry.deletedAt &&
            entry.workspaceId === file.workspaceId,
        )
        .map((space) => ({ id: space.id, title: space.title, parentId: null })),
      ...documents.map((document) => ({
        id: document.id,
        title: document.title,
        parentId: document.parentDocumentId ?? document.spaceId,
      })),
    ],
    [snapshot.library, documents, file.workspaceId],
  );
  const spaceIds = useMemo(
    () =>
      new Set(
        snapshot.library
          .filter((entry) => entry.kind === "SPACE")
          .map((entry) => entry.id),
      ),
    [snapshot.library],
  );
  const documentLinks = useMemo(
    () =>
      snapshot.links
        .filter((link) => !link.deletedAt)
        .flatMap((link) => {
          const other =
            link.from.kind === "FILE" && link.from.id === file.id
              ? link.to
              : link.to.kind === "FILE" && link.to.id === file.id
                ? link.from
                : null;
          const document =
            other?.kind === "DOCUMENT" ? documentById.get(other.id) : undefined;
          return document ? [{ link, document }] : [];
        }),
    [snapshot.links, file.id, documentById],
  );
  const linkedDocumentIds = useMemo(
    () => new Set(documentLinks.map((entry) => entry.document.id)),
    [documentLinks],
  );
  const projects = useMemo(
    () =>
      snapshot.items.filter(
        (item) => item.type === "PROJECT" && !item.deletedAt,
      ),
    [snapshot.items],
  );
  const projectById = useMemo(
    () => new Map(projects.map((project) => [project.id, project])),
    [projects],
  );
  const projectLinks = useMemo(
    () =>
      snapshot.links
        .filter((link) => !link.deletedAt)
        .flatMap((link) => {
          const other =
            link.from.kind === "FILE" && link.from.id === file.id
              ? link.to
              : link.to.kind === "FILE" && link.to.id === file.id
                ? link.from
                : null;
          const project =
            other?.kind === "WORK" ? projectById.get(other.id) : undefined;
          return project ? [{ link, project }] : [];
        }),
    [snapshot.links, file.id, projectById],
  );
  const linkedIds = useMemo(
    () => new Set(projectLinks.map((entry) => entry.project.id)),
    [projectLinks],
  );
  const [extracting, setExtracting] = useState(false);
  const previewChunks = useMemo(
    () =>
      preview?.chunks.map((chunk) => ({ ...chunk, id: chunk.locator })) ?? [],
    [preview],
  );
  const tier = fileReadTier(file.extension);
  useEffect(() => {
    if (file.deletedAt) return;
    let active = true;
    const read = () => {
      void runtime
        .readFileProcessing(file.id)
        .then((record) => {
          if (active) setProcessing(record);
        })
        .catch((failure) => {
          if (active)
            setError(
              failure instanceof Error
                ? failure.message
                : "FILE_PROCESSING_UNAVAILABLE",
            );
        });
    };
    const unsubscribe = runtime.subscribeFileProcessing(file.id, read);
    read();
    return () => {
      active = false;
      unsubscribe();
    };
  }, [runtime, file.id, file.version, file.deletedAt]);

  useEffect(() => {
    setPreview(null);
    if (
      file.deletedAt ||
      tier === "STORAGE" ||
      file.size > fileExtractionLimits.inputBytes
    )
      return;
    let active = true;
    const controller = new AbortController();
    setExtracting(true);
    const infrastructureFailure = runtime.fileProcessingFailure();
    if (infrastructureFailure)
      setError(
        zh
          ? "后台文件处理暂时不可用。可重试读取原始文件。"
          : "Background file processing is unavailable. Retry reading the original file.",
      );
    void runtime
      .extractFile(file.id, file.version, controller.signal)
      .then((document) => {
        if (active) setPreview(document);
      })
      .catch((failure) => {
        if (active)
          setError(
            failure instanceof Error ? failure.message : "FILE_READ_FAILED",
          );
      })
      .finally(() => {
        if (active) setExtracting(false);
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [
    runtime,
    file.id,
    file.version,
    file.contentHash,
    file.size,
    file.deletedAt,
    tier,
    previewAttempt,
    zh,
  ]);
  async function run(action: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (failure) {
      setError(
        failure instanceof Error ? failure.message : "FILE_OPERATION_FAILED",
      );
    } finally {
      setBusy(false);
    }
  }
  async function close() {
    if (busy) return false;
    if (
      (name !== file.name || policyDirty) &&
      !(await confirmAction(
        zh ? "放弃未保存的文件修改？" : "Discard unsaved file changes?",
      ))
    )
      return false;
    onClose();
    return true;
  }
  if (file.deletedAt)
    return (
      <section className="file-detail" role="region" aria-label={file.name}>
        <p role="status">
          {zh ? "此文件已移至回收站。" : "This file has been moved to Trash."}
        </p>
        <Button
          variant="ghost"
          disabled={busy}
          onClick={() => {
            void close();
          }}
        >
          {zh ? "关闭文件" : "Close file"}
        </Button>
      </section>
    );
  return (
    <section className="file-detail" role="region" aria-labelledby={titleId}>
      <div className="ui-toolbar">
        <h2 id={titleId}>{file.name}</h2>
        <Button
          variant="ghost"
          disabled={busy || tier === "STORAGE"}
          onClick={() => setAtlasOpen(true)}
        >
          {zh ? "询问 Atlas" : "Ask Atlas"}
        </Button>
        <IconButton
          label={zh ? "关闭文件" : "Close file"}
          disabled={busy}
          onClick={() => {
            void close();
          }}
        >
          <X />
        </IconButton>
      </div>
      {error && (
        <div role="alert">
          <p>
            {zh
              ? "无法完成文件操作，请重试。"
              : "The file operation failed. Please try again."}
          </p>
          <details>
            <summary>{zh ? "技术详情" : "Technical details"}</summary>
            <pre>{safeFileFailureCode(error)}</pre>
          </details>
        </div>
      )}
      {atlasOpen && (
        <FileAtlasFloat
          key={`${file.id}:${file.version}`}
          file={file}
          runtime={runtime}
          zh={zh}
          draft={atlasDraft}
          onDraft={onAtlasDraft}
          onClose={() => setAtlasOpen(false)}
        />
      )}
      <dl className="file-metadata">
        <dt>{zh ? "原始名称" : "Original name"}</dt>
        <dd>{file.originalName}</dd>
        <dt>{zh ? "大小" : "Size"}</dt>
        <dd>{new Intl.NumberFormat(i18n.language).format(file.size)} B</dd>
        <dt>{zh ? "类型" : "Type"}</dt>
        <dd>{file.mime}</dd>
        <dt>{zh ? "内容" : "Content"}</dt>
        <dd>
          {tier === "STORAGE"
            ? zh
              ? "仅存储"
              : "Storage only"
            : zh
              ? "保留原始文件"
              : "Original file preserved"}
        </dd>
        <dt>{zh ? "Atlas 访问" : "Atlas access"}</dt>
        <dd>
          {file.aiPolicy.aiAccess === "DENY"
            ? zh
              ? "未授权"
              : "Not permitted"
            : zh
              ? "按内容权限"
              : "Content permissions apply"}
        </dd>
      </dl>
      <ContentPolicyEditor
        value={policy}
        onChange={setPolicy}
        disabled={busy}
      />
      {tier !== "STORAGE" && (
        <EntityMemo runtime={runtime} targetKind="FILE" targetId={file.id} />
      )}
      {policyDirty && (
        <Button
          variant="secondary"
          disabled={busy}
          onClick={() => {
            void run(async () => {
              if (
                !(await confirmAction(
                  zh
                    ? "保存文件内容权限？此操作不会向 Atlas 发送内容；使用时仍需遵守审批与处理位置限制。"
                    : "Save file content permissions? This does not send content to Atlas. Approval and processing boundaries still apply.",
                ))
              )
                return;
              await runtime.setFilePolicy(file.id, file.version, policy);
              await onChanged();
            });
          }}
        >
          {zh ? "保存内容权限" : "Save content permissions"}
        </Button>
      )}
      {processing?.state === "FAILED" && (
        <div className="ui-toolbar" role="status">
          <span>
            {zh
              ? "文件内容处理未完成，原文件已保留。"
              : "File content processing failed. The original file is preserved."}
          </span>
          <Button
            variant="ghost"
            disabled={busy || extracting}
            onClick={() => {
              void run(async () => {
                const record = await runtime.retryFileProcessing(file.id);
                setProcessing(record);
                if (record?.state === "FAILED") {
                  setError("FILE_EXTRACTION_" + record.error);
                  return;
                }
                setPreviewAttempt((attempt) => attempt + 1);
              });
            }}
          >
            {zh ? "重试处理" : "Retry processing"}
          </Button>
        </div>
      )}
      <label className="field">
        <span>{zh ? "文件名称" : "File name"}</span>
        <input
          value={name}
          disabled={busy}
          onChange={(event) => setName(event.target.value)}
        />
      </label>
      <div className="ui-toolbar">
        <Button
          variant="primary"
          disabled={busy || !name.trim() || name === file.name}
          pending={busy}
          onClick={() => {
            void run(async () => {
              await runtime.renameFile(file.id, file.version, name);
              await onChanged();
            });
          }}
        >
          {zh ? "保存名称" : "Save name"}
        </Button>
        <Button
          variant="secondary"
          disabled={busy}
          onClick={() => {
            void run(async () => {
              const bytes = await runtime.readFileBytes(file.id);
              const url = URL.createObjectURL(
                new Blob([bytes], { type: "application/octet-stream" }),
              );
              const link = document.createElement("a");
              link.href = url;
              link.download = file.originalName;
              link.click();
              setTimeout(() => URL.revokeObjectURL(url), 1000);
            });
          }}
        >
          <Download size={16} />
          {zh ? "下载原始文件" : "Download original"}
        </Button>
        <EntityMenu
          title={file.name}
          pending={busy}
          onDelete={() => {
            void run(async () => {
              const deleted = await runtime.deleteFile(
                file.id,
                file.version,
                true,
              );
              await onChanged();
              onClose();
              showToast(zh ? "已移至回收站" : "Moved to Trash", async () => {
                await runtime.deleteFile(deleted.id, deleted.version, false);
                await onChanged();
              });
            });
          }}
        />
        <Button
          variant="ghost"
          disabled={busy}
          onClick={() => {
            void run(async () => {
              await navigator.clipboard.writeText(fileMarkdownLink(file));
              showToast(zh ? "文件引用已复制" : "File reference copied");
            });
          }}
        >
          {zh ? "复制引用" : "Copy reference"}
        </Button>
      </div>
      <details className="file-project-links">
        <summary>
          {zh ? "关联项目" : "Linked projects"}
          {projectLinks.length ? ` (${projectLinks.length})` : ""}
        </summary>
        {projectLinks.map(({ link, project }) => (
          <div key={link.id} className="ui-toolbar">
            <a
              href={projectHash({
                projectId: project.id,
                tab: "overview",
                scope: "SUBTREE",
              })}
            >
              {project.title}
            </a>
            <Button
              variant="ghost"
              disabled={busy}
              onClick={() => {
                void run(() =>
                  runtime.unlink(link.id, link.version).then(onChanged),
                );
              }}
            >
              {zh ? "解除关联" : "Unlink"}
            </Button>
          </div>
        ))}
        <div className="ui-toolbar">
          <ProjectDrilldownPicker
            projects={projects}
            mode="single"
            value={projectId}
            excludedIds={linkedIds}
            disabled={busy}
            label={zh ? "选择关联项目" : "Choose a project to link"}
            onChange={(value) =>
              setProjectId(typeof value === "string" ? value : null)
            }
          />
          <Button
            variant="ghost"
            disabled={busy || !projectId || linkedIds.has(projectId)}
            onClick={() => {
              if (projectId)
                void run(async () => {
                  await runtime.link(
                    { kind: "FILE", id: file.id },
                    { kind: "WORK", id: projectId },
                    "RELATED",
                  );
                  await onChanged();
                  setProjectId(null);
                });
            }}
          >
            {zh ? "关联" : "Link"}
          </Button>
        </div>
      </details>
      <details className="file-document-links">
        <summary>
          {zh ? "关联文档" : "Linked documents"}
          {documentLinks.length ? ` (${documentLinks.length})` : ""}
        </summary>
        {documentLinks.map(({ link, document }) => (
          <div key={link.id} className="ui-toolbar">
            <Button
              variant="ghost"
              onClick={() => {
                void close().then((closed) => {
                  if (closed) onOpenDocument(document);
                });
              }}
            >
              {document.title}
            </Button>
            <Button
              variant="ghost"
              disabled={busy}
              onClick={() => {
                void run(() =>
                  runtime.unlink(link.id, link.version).then(onChanged),
                );
              }}
            >
              {zh ? "解除关联" : "Unlink"}
            </Button>
          </div>
        ))}
        <div className="ui-toolbar">
          <HierarchyPicker
            kind="DOCUMENT"
            entries={documentEntries}
            mode="single"
            values={documentId ? [documentId] : []}
            disabledIds={spaceIds}
            excludedIds={linkedDocumentIds}
            disabled={busy}
            initialParentId={file.spaceId}
            label={zh ? "选择关联文档" : "Choose a document to link"}
            rootLabel={zh ? "知识空间" : "Knowledge spaces"}
            onChange={(ids) => setDocumentId(ids[0] ?? null)}
          />
          <Button
            variant="ghost"
            disabled={
              busy ||
              !documentId ||
              !documentById.has(documentId) ||
              linkedDocumentIds.has(documentId)
            }
            onClick={() => {
              if (documentId)
                void run(async () => {
                  await runtime.link(
                    { kind: "FILE", id: file.id },
                    { kind: "DOCUMENT", id: documentId },
                    "REFERENCES",
                  );
                  await onChanged();
                  setDocumentId(null);
                });
            }}
          >
            {zh ? "关联" : "Link"}
          </Button>
        </div>
      </details>
      {extracting && (
        <p role="status">
          {zh ? "正在读取文件内容…" : "Reading file content…"}
        </p>
      )}
      {preview !== null && (
        <div className="file-text-preview">
          <VirtualTaskCollection
            items={previewChunks}
            virtualizeAfter={10}
            estimatedRowHeight={240}
            render={(chunk) => (
              <section key={chunk.locator}>
                {chunk.title && <h3>{chunk.title}</h3>}
                <pre>{chunk.text}</pre>
              </section>
            )}
          />
        </div>
      )}
    </section>
  );
}
