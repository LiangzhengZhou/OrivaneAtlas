import {
  type LibraryEntry,
  type Note,
  privateContentPolicy,
  scopedKnowledgeDocuments,
} from "@arclattice/application";
import type { EditorView } from "@codemirror/view";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { showToast } from "./app/ToastHost";
import type { Runtime, Snapshot } from "./bootstrap";
import { ContentPolicyEditor } from "./ContentPolicyEditor";
import { exportHtml, exportMarkdownZip, exportPdf } from "./documentExports";
import { FilePicker } from "./FilePicker";
import { DiffViewer } from "./features/documents/DiffViewer";
import { DocumentDrilldownPicker } from "./features/documents/DocumentDrilldownPicker";
import { DocumentPopover } from "./features/documents/DocumentPopover";
import { mergeMarkdown } from "./features/documents/merge";
import { NoteKnowledgeActions } from "./features/knowledge/NoteKnowledgeActions";
import { WikiRelations } from "./features/knowledge/WikiRelations";
import { imageAnchor, pendingImage } from "./imageInsertion";
import { LiveMarkdown } from "./LiveMarkdown";
import {
  clearDraft,
  draftMatchesBase,
  loadDraft,
  saveDraft,
} from "./localDrafts";
import { Markdown } from "./Markdown";
import { downloadText } from "./utils/download";

export type DocumentRequest = {
  key: string;
  kind: "NOTE" | "JOURNAL" | "SPACE" | "DOCUMENT";
  entity?: Note | LibraryEntry | undefined;
  day?: string | undefined;
  spaceId?: string | null | undefined;
  projectId?: string | undefined;
};
type Tab = DocumentRequest & {
  dirty?: boolean;
  busy?: boolean;
  title?: string;
};
export function DocumentWorkspace({
  request,
  visible,
  runtime,
  onChange,
  onBrowse,
  onVisibility,
  snapshot,
  onDirty,
  onActive,
}: {
  request: DocumentRequest | null;
  visible: boolean;
  runtime: Runtime;
  onChange: () => void;
  onBrowse: () => void;
  onVisibility: () => void;
  snapshot: Snapshot;
  onDirty: (dirty: boolean) => void;
  onActive: (request: DocumentRequest | null) => void;
}) {
  const { i18n } = useTranslation();
  const zh = i18n.language.startsWith("zh");
  const [tabs, setTabs] = useState<Tab[]>([]),
    [active, setActive] = useState("");
  const tabsRef = useRef(tabs);
  tabsRef.current = tabs;
  useEffect(
    () =>
      onActive(
        visible ? (tabs.find((tab) => tab.key === active) ?? null) : null,
      ),
    [tabs, active, visible, onActive],
  );
  useEffect(
    () => onDirty(tabs.some((t) => t.dirty || t.busy)),
    [tabs, onDirty],
  );
  useEffect(() => {
    if (!request) return;
    const existing = tabsRef.current.find(
      (t) =>
        t.key === request.key ||
        (request.entity && t.entity?.id === request.entity.id),
    );
    setActive(existing?.key ?? request.key);
    setTabs((old) => {
      const existing = old.find(
        (t) =>
          t.key === request.key ||
          (request.entity && t.entity?.id === request.entity.id),
      );
      return existing ? old : [...old, request];
    });
  }, [request]);
  useEffect(() => {
    const leave = (e: BeforeUnloadEvent) => {
      if (tabs.some((t) => t.dirty || t.busy)) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", leave);
    return () => window.removeEventListener("beforeunload", leave);
  }, [tabs]);
  function close(tab: Tab) {
    if (tab.busy) return;
    if (
      tab.dirty &&
      !window.confirm(
        zh
          ? "尚有未保存内容，关闭将丢弃此草稿。是否关闭？"
          : "Unsaved draft will be lost. Close this tab?",
      )
    )
      return;
    const next = tabs.filter((t) => t.key !== tab.key);
    setTabs(next);
    if (active === tab.key) setActive(next.at(-1)?.key ?? "");
    if (!next.length) onBrowse();
  }
  return (
    <section className="document-workspace" hidden={!tabs.length}>
      <div
        className="document-tabs no-print"
        role="tablist"
        aria-label={zh ? "打开的文档" : "Open documents"}
      >
        <button type="button" className="chip" onClick={onBrowse}>
          {zh ? "工作台" : "Workspace"}
        </button>
        {tabs.map((tab) => (
          <div className="document-tab" key={tab.key}>
            <button
              type="button"
              role="tab"
              aria-selected={visible && active === tab.key}
              onClick={() => {
                setActive(tab.key);
                onVisibility();
              }}
            >
              {tab.dirty ? "● " : ""}
              {tab.title ||
                tab.entity?.title ||
                tab.day ||
                (zh ? "未命名" : "Untitled")}
            </button>
            <button
              type="button"
              aria-label={
                (zh ? "关闭 " : "Close ") +
                (tab.title || tab.entity?.title || tab.day || "")
              }
              onClick={() => close(tab)}
              disabled={tab.busy}
            >
              ×
            </button>
          </div>
        ))}
      </div>
      {tabs.map((tab) => (
        <div key={tab.key} hidden={!visible || active !== tab.key}>
          <DocumentPane
            snapshot={snapshot}
            onWikiCreated={(entity) => {
              const key = `DOCUMENT:${entity.id}`;
              setTabs((old) => [
                ...old,
                {
                  key,
                  kind: "DOCUMENT",
                  entity,
                  spaceId: entity.spaceId,
                  projectId: tab.projectId,
                },
              ]);
              setActive(key);
            }}
            onWikiOpen={(id) => {
              const entity = [...snapshot.library, ...snapshot.notes].find(
                (entry) => entry.id === id && !entry.deletedAt,
              );
              if (!entity) return;
              const key = `${entity.kind}:${id}`;
              setTabs((old) =>
                old.some((entry) => entry.key === key)
                  ? old
                  : [
                      ...old,
                      {
                        key,
                        kind: entity.kind,
                        entity,
                        spaceId: "spaceId" in entity ? entity.spaceId : null,
                        projectId: tab.projectId,
                      },
                    ],
              );
              setActive(key);
            }}
            request={tab}
            runtime={runtime}
            remote={[...snapshot.notes, ...snapshot.library].find(
              (e) => e.id === tab.entity?.id,
            )}
            onSaved={onChange}
            onClose={() => close({ ...tab, dirty: false, busy: false })}
            onStatus={(dirty, title, entity, busy) =>
              setTabs((old) =>
                old.map((t) =>
                  t.key === tab.key &&
                  (t.dirty !== dirty ||
                    t.busy !== busy ||
                    t.title !== title ||
                    t.entity !== entity)
                    ? { ...t, dirty, title, entity, busy }
                    : t,
                ),
              )
            }
          />
        </div>
      ))}
    </section>
  );
}
function DocumentPane({
  snapshot,
  onWikiCreated,
  onWikiOpen,
  request,
  runtime,
  onSaved,
  onClose,
  onStatus,
  remote,
}: {
  snapshot: Snapshot;
  onWikiCreated(entity: LibraryEntry): void;
  onWikiOpen(id: string): void;
  request: DocumentRequest;
  runtime: Runtime;
  onSaved: () => void;
  onClose: () => void;
  remote: Note | LibraryEntry | undefined;
  onStatus: (
    dirty: boolean,
    title: string,
    entity: Note | LibraryEntry | undefined,
    busy: boolean,
  ) => void;
}) {
  const { t } = useTranslation("desk");
  const { t: s, i18n } = useTranslation("spaces");
  const { t: c } = useTranslation("common");
  const zh = i18n.language.startsWith("zh");
  const [base, setBase] = useState(request.entity),
    [title, setTitle] = useState(request.entity?.title ?? request.day ?? ""),
    [body, setBody] = useState(request.entity?.bodyMd ?? "");
  const [aiPolicy, setAiPolicy] = useState(
    request.entity?.aiPolicy ?? privateContentPolicy,
  );
  const [mode, setMode] = useState<"live" | "source" | "read">("live"),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [composing, setComposing] = useState(false),
    [history, setHistory] = useState<(Note | LibraryEntry)[]>([]);
  const [historyOpenRequest, setHistoryOpenRequest] = useState(0);
  const [username, setUsername] = useState(""),
    [password, setPassword] = useState("");
  const editor = useRef<EditorView | null>(null),
    gate = useRef(false),
    failed = useRef(false),
    baseRef = useRef(base);
  const current = useRef({ title, body, composing, aiPolicy });
  current.current = { title, body, composing, aiPolicy };
  const callbacks = useRef({ onStatus, onSaved });
  callbacks.current = { onStatus, onSaved };
  const library = request.kind === "SPACE" || request.kind === "DOCUMENT";
  const dirty =
    title !== (base?.title ?? request.day ?? "") ||
    body !== (base?.bodyMd ?? "") ||
    JSON.stringify(aiPolicy) !==
      JSON.stringify(base?.aiPolicy ?? privateContentPolicy);
  const draftKey = JSON.stringify([
    runtime.serverOrigin,
    runtime.context?.workspaceId ?? "unknown",
    runtime.context?.principalId ?? "unknown",
    request.key,
  ]);
  const restored = useRef(false);
  const recoveryRequired = useRef(false);
  useEffect(() => {
    let active = true;
    restored.current = false;
    void loadDraft(draftKey).then((draft) => {
      if (!active) return;
      if (!draft) {
        restored.current = true;
        return;
      }
      recoveryRequired.current = !draftMatchesBase(
        draft,
        baseRef.current?.id ?? request.key,
        baseRef.current,
      );
      if (recoveryRequired.current) {
        failed.current = true;
        setError("VERSION_CONFLICT");
      }
      setTitle(draft.title);
      setBody(draft.body);
      restored.current = true;
    });
    return () => {
      active = false;
    };
  }, [draftKey]);
  useEffect(() => {
    if (
      !restored.current ||
      recoveryRequired.current ||
      !dirty ||
      aiPolicy.classification === "SENSITIVE" ||
      aiPolicy.classification === "SECRET"
    )
      return;
    const timer = setTimeout(
      () =>
        void saveDraft(draftKey, {
          title,
          body,
          updatedAt: Date.now(),
          savedAt: Date.now(),
          entityId: base?.id ?? request.key,
          baseVersion: base?.version ?? 0,
          baseUpdatedAt: base?.updatedAt ?? null,
        }),
      250,
    );
    return () => clearTimeout(timer);
  }, [
    draftKey,
    title,
    body,
    dirty,
    base,
    request.key,
    aiPolicy.classification,
  ]);
  useEffect(() => {
    callbacks.current.onStatus(dirty, title, base, busy);
  }, [dirty, title, base, busy]);
  useEffect(() => {
    if (!remote || !base || remote.version <= base.version || busy || composing)
      return;
    if (dirty) {
      failed.current = true;
      setError("VERSION_CONFLICT");
      return;
    }
    baseRef.current = remote;
    setBase(remote);
    setTitle(remote.title);
    setBody(remote.bodyMd);
    setAiPolicy(remote.aiPolicy ?? privateContentPolicy);
  }, [remote, base, busy, dirty, composing]);
  async function save(explicit = false) {
    if (
      !restored.current ||
      recoveryRequired.current ||
      gate.current ||
      current.current.composing ||
      (!explicit && failed.current)
    )
      return;
    const draft = { ...current.current },
      previous = baseRef.current;
    if (previous?.deletedAt) {
      failed.current = true;
      setError("NOT_FOUND");
      return;
    }
    if (
      !draft.title.trim() ||
      (!previous && !draft.body.trim() && request.kind === "JOURNAL")
    )
      return;
    if (
      previous &&
      draft.title === previous.title &&
      draft.body === previous.bodyMd &&
      JSON.stringify(draft.aiPolicy) ===
        JSON.stringify(previous.aiPolicy ?? privateContentPolicy)
    )
      return;
    gate.current = true;
    setBusy(true);
    setError("");
    try {
      const value =
        library && !previous && request.projectId && request.spaceId
          ? await runtime.createProjectDocument({
              projectId: request.projectId,
              spaceId: request.spaceId,
              title: draft.title,
              bodyMd: draft.body,
              aiPolicy: draft.aiPolicy,
            })
          : library
            ? await runtime.saveLibrary(
                previous?.id ?? null,
                previous?.version ?? 0,
                {
                  kind: request.kind as "SPACE" | "DOCUMENT",
                  spaceId: request.spaceId ?? null,
                  title: draft.title,
                  bodyMd: draft.body,
                  aiPolicy: draft.aiPolicy,
                },
              )
            : await runtime.saveNote(
                previous?.id ?? null,
                previous?.version ?? 0,
                {
                  kind: request.kind as "NOTE" | "JOURNAL",
                  day:
                    request.kind === "JOURNAL"
                      ? (request.day ?? (previous as Note)?.day ?? null)
                      : null,
                  title: draft.title,
                  bodyMd: draft.body,
                  aiPolicy: draft.aiPolicy,
                },
              );
      baseRef.current = value;
      setBase(value);
      await clearDraft(draftKey);
      failed.current = false;
      callbacks.current.onSaved();
    } catch (cause) {
      failed.current = true;
      setError((cause as { code?: string }).code ?? "UNAVAILABLE");
    } finally {
      gate.current = false;
      setBusy(false);
    }
  }
  const saver = useRef(save);
  saver.current = save;
  useEffect(() => {
    if (!dirty || composing || busy) return;
    const timer = setTimeout(() => void saver.current(), 1000);
    return () => clearTimeout(timer);
  }, [title, body, aiPolicy, dirty, composing, busy]);
  async function guarded(action: () => Promise<void>) {
    if (gate.current) return;
    gate.current = true;
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (cause) {
      setError((cause as { code?: string }).code ?? "UNAVAILABLE");
    } finally {
      gate.current = false;
      setBusy(false);
    }
  }
  const [imageError, setImageError] = useState("");
  function insertImages(files: File[]) {
    setImageError("");
    if (gate.current) {
      setImageError(
        zh
          ? "正在保存或上传，请稍后重新粘贴或选择图片。"
          : "Saving or uploading. Please paste or select the image again shortly.",
      );
      return;
    }
    const file = files[0];
    if (
      files.length !== 1 ||
      !file ||
      file.size === 0 ||
      !["image/png", "image/jpeg", "image/webp"].includes(file.type)
    ) {
      setImageError(
        zh
          ? "请每次选择或粘贴一张非空的 PNG、JPEG 或 WebP 图片。"
          : "Select or paste one non-empty PNG, JPEG or WebP image at a time.",
      );
      return;
    }
    const view = editor.current;
    if (!view) return;
    view.dispatch({ effects: imageAnchor.of(view.state.selection.main.head) });
    void guarded(async () => {
      try {
        const asset = await runtime.uploadImage(request.spaceId ?? null, file);
        if (editor.current !== view) return;
        const position = view.state.field(pendingImage);
        const insert = "\n![](" + asset.url + ")\n";
        if (
          position === null ||
          view.state.doc.length + insert.length > 200000
        ) {
          setImageError(
            zh
              ? "正文已被替换或超过长度限制，未插入图片。请重新选择图片。"
              : "The document was replaced or is too long. Image not inserted; please select it again.",
          );
          return;
        }
        view.dispatch({
          changes: { from: position, insert },
          effects: imageAnchor.of(null),
        });
      } catch (cause) {
        setImageError(
          zh
            ? "图片上传失败，请检查连接、登录状态或工作区容量后重试。正文未被替换。"
            : "Image upload failed. Check your connection, session or workspace quota and retry. Your text was not replaced.",
        );
        throw cause;
      } finally {
        if (editor.current === view)
          view.dispatch({ effects: imageAnchor.of(null) });
      }
    });
  }
  return (
    <article className="document-pane">
      <div className="document-toolbar no-print">
        <DocumentPopover
          className="document-mode-menu"
          label={<>{mode === "read" ? t("read") : zh ? "编辑" : "Edit"} ▾</>}
        >
          {(["live", "source", "read"] as const).map((value) => (
            <button
              key={value}
              type="button"
              className={"chip " + (mode === value ? "active" : "")}
              onClick={() => setMode(value)}
            >
              {value === "live"
                ? zh
                  ? "实时预览"
                  : "Live preview"
                : value === "source"
                  ? zh
                    ? "源码"
                    : "Source"
                  : t("read")}
            </button>
          ))}
        </DocumentPopover>
        <span className="action-spacer" />
        <span role="status">
          {busy
            ? t("saving")
            : dirty
              ? zh
                ? "未保存"
                : "Unsaved"
              : zh
                ? "已保存"
                : "Saved"}
        </span>
        <DocumentPopover className="document-actions-menu" label={<>···</>}>
          <DocumentPopover
            className="document-export"
            label={zh ? "导出" : "Export"}
          >
            <button
              className="chip"
              type="button"
              onClick={() => downloadText((title || "document") + ".md", body)}
            >
              {t("exportMarkdown")}
            </button>
            <button className="chip" type="button" onClick={exportPdf}>
              {s("pdf")}
            </button>
            <button
              className="chip"
              type="button"
              onClick={() =>
                void exportHtml(title || "document", body, runtime.loadImage)
              }
            >
              {zh ? "导出 HTML" : "Export HTML"}
            </button>
            <button
              className="chip"
              type="button"
              onClick={() =>
                void exportMarkdownZip(
                  title || "document",
                  body,
                  runtime.loadImage,
                )
              }
            >
              {zh ? "导出 ZIP（含图片）" : "Export ZIP with images"}
            </button>
          </DocumentPopover>
          {base && (
            <button
              className="chip"
              type="button"
              disabled={busy}
              onClick={() =>
                void guarded(async () => {
                  setHistoryOpenRequest((value) => value + 1);
                  setHistory(
                    history.length
                      ? []
                      : await (library
                          ? runtime.libraryRevisions(base.id)
                          : runtime.revisions(base.id)),
                  );
                })
              }
            >
              {t("revisions")}
            </button>
          )}
          {base && (
            <button
              className="chip"
              type="button"
              disabled={busy}
              onClick={() => {
                void guarded(async () => {
                  await (library
                    ? runtime.deleteLibrary(base.id, base.version, true)
                    : runtime.deleteNote(base.id, base.version, true));
                  onSaved();
                  showToast(
                    zh ? "文档已移入回收站" : "Document moved to trash",
                    async () => {
                      await (library
                        ? runtime.deleteLibrary(
                            base.id,
                            base.version + 1,
                            false,
                          )
                        : runtime.deleteNote(base.id, base.version + 1, false));
                      onSaved();
                    },
                  );
                  onClose();
                });
              }}
            >
              {c("delete")}
            </button>
          )}
          <DocumentPopover
            className="document-policy no-print"
            label={<>{zh ? "AI 权限" : "AI permissions"}</>}
          >
            <ContentPolicyEditor
              value={aiPolicy}
              onChange={setAiPolicy}
              disabled={busy}
            />
          </DocumentPopover>
          <DocumentPopover
            className="document-tools no-print"
            requestOpen={historyOpenRequest}
            label={
              <>{zh ? "导入、图片与修订" : "Import, images and revisions"}</>
            }
          >
            <div className="document-upload-grid">
              <FilePicker
                label={t("importMarkdown")}
                hint={
                  zh
                    ? "选择 .md / .txt · UTF-8 · 最大 600 KB"
                    : "Choose .md / .txt · UTF-8 · up to 600 KB"
                }
                disabled={busy}
                accept=".md,.markdown,.txt"
                onFile={(file) => {
                  if (dirty && !window.confirm(s("leave"))) return;
                  void guarded(async () => {
                    if (
                      file.size > 600000 ||
                      !/\.(md|markdown|txt)$/i.test(file.name)
                    )
                      throw new Error("size");
                    const value = new TextDecoder("utf-8", {
                      fatal: true,
                    }).decode(await file.arrayBuffer());
                    if (value.length > 200000) throw new Error("size");
                    setBody(value);
                    if (!title)
                      setTitle(
                        file.name
                          .replace(/\.(md|markdown|txt)$/i, "")
                          .slice(0, 240),
                      );
                  });
                }}
              />
              <FilePicker
                label={s("image")}
                hint={
                  zh
                    ? "PNG / JPEG / WebP · 不限文件大小"
                    : "PNG / JPEG / WebP · No file-size cap"
                }
                disabled={busy || !!base?.deletedAt}
                accept="image/png,image/jpeg,image/webp"
                onFile={(file) => insertImages([file])}
              />
            </div>
            <p className="upload-hint">
              {zh
                ? "也可在编辑器内直接粘贴图片（Ctrl/⌘ V）。图片保存在自己的服务器，仅当前工作区可访问；导出的 Markdown 不包含图片文件。"
                : "Or paste an image into the editor (Ctrl/⌘ V). Images stay on your server, accessible only within this workspace; Markdown exports do not include image files."}
            </p>
            {history.map((revision) => (
              <details key={revision.version}>
                <summary>
                  v{revision.version} · {revision.updatedAt}
                </summary>
                <DiffViewer before={revision.bodyMd} after={body} />
                <button
                  className="chip"
                  type="button"
                  onClick={() => {
                    setTitle(revision.title);
                    setBody(revision.bodyMd);
                    setHistory([]);
                  }}
                >
                  {t("useRevision")}
                </button>
              </details>
            ))}
          </DocumentPopover>
        </DocumentPopover>
      </div>
      {base?.deletedAt && (
        <div className="connected-notice">
          <p>
            {zh
              ? "此文档在回收站中。恢复后才能继续保存。"
              : "This document is in trash. Restore it before editing."}
          </p>
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              void guarded(async () => {
                const restored = await (library
                  ? runtime.deleteLibrary(base.id, base.version, false)
                  : runtime.deleteNote(base.id, base.version, false));
                baseRef.current = restored;
                setBase(restored);
                failed.current = false;
                onSaved();
              })
            }
          >
            {zh ? "恢复文档" : "Restore document"}
          </button>
        </div>
      )}
      {error && (
        <div className="error no-print" role="alert">
          <strong>{error}</strong>
          {recoveryRequired.current && !base && (
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                if (
                  !window.confirm(
                    zh
                      ? "将恢复的草稿保存为新文档？"
                      : "Save the recovered draft as a new document?",
                  )
                )
                  return;
                recoveryRequired.current = false;
                failed.current = false;
                void save(true);
              }}
            >
              {zh ? "确认恢复并保存" : "Confirm recovery and save"}
            </button>
          )}
          {error === "VERSION_CONFLICT" && remote && (
            <details>
              <summary>
                {zh ? "对照远端版本" : "Compare remote version"}
              </summary>
              <h3>{remote.title}</h3>
              <Markdown text={remote.bodyMd} />
              <DiffViewer before={remote.bodyMd} after={body} />
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  const merged = mergeMarkdown(
                    base?.bodyMd ?? "",
                    body,
                    remote.bodyMd,
                  );
                  setBody(merged.text);
                  baseRef.current = remote;
                  setBase(remote);
                  failed.current = false;
                  setError("");
                  recoveryRequired.current = merged.conflicts > 0;
                }}
              >
                {zh ? "三方合并" : "Merge"}
              </button>
              <button
                type="button"
                disabled={busy || !!remote.deletedAt}
                onClick={() => {
                  if (
                    !window.confirm(
                      zh
                        ? "将当前草稿作为合并结果，在远端最新版本上保存？请先检查差异。"
                        : "Save the current draft as your merged result on the latest remote version? Review differences first.",
                    )
                  )
                    return;
                  recoveryRequired.current = false;
                  baseRef.current = remote;
                  setBase(remote);
                  failed.current = false;
                  setError("");
                  void save(true);
                }}
              >
                {zh
                  ? "确认合并并保存我的草稿"
                  : "Confirm merge and save my draft"}
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  if (
                    !window.confirm(
                      zh
                        ? "丢弃本地草稿并载入远端版本？"
                        : "Discard local draft and load remote version?",
                    )
                  )
                    return;
                  baseRef.current = remote;
                  setBase(remote);
                  setTitle(remote.title);
                  setBody(remote.bodyMd);
                  setAiPolicy(remote.aiPolicy ?? privateContentPolicy);
                  void clearDraft(draftKey);
                  failed.current = false;
                  setError("");
                }}
              >
                {zh ? "载入远端版本" : "Load remote version"}
              </button>
            </details>
          )}
          <p>
            {zh
              ? "草稿已保留在此标签页。请导出备份；版本冲突时不会覆盖远端正文。修复后点击保存重试。"
              : "Your draft remains in this tab. Export a backup; conflicts never overwrite remote text. Retry Save after resolving the error."}
          </p>
          {error === "UNAUTHORIZED" && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void guarded(async () => {
                  const context = await runtime.session(
                    username ? { username, password } : password,
                    runtime.context ?? undefined,
                  );
                  setPassword("");
                  if (
                    context.workspaceId !== runtime.context?.workspaceId ||
                    context.principalId !== runtime.context?.principalId
                  ) {
                    await runtime.logout();
                    throw new Error("identity");
                  }
                  failed.current = false;
                });
              }}
            >
              <input
                aria-label={s("username")}
                autoComplete="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
              />
              <input
                aria-label={s("password")}
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              <button disabled={busy}>{s("login")}</button>
            </form>
          )}
        </div>
      )}
      <input
        className="document-title no-print"
        aria-label={
          library
            ? s(request.kind === "SPACE" ? "spaceTitle" : "title")
            : t("noteTitle")
        }
        maxLength={240}
        placeholder={t("noteTitle")}
        value={title}
        onCompositionStart={() => setComposing(true)}
        onCompositionEnd={() => setComposing(false)}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => {
          if ((e.ctrlKey || e.metaKey) && e.key === "s") {
            e.preventDefault();
            void save(true);
          }
        }}
      />

      {imageError && (
        <p className="error" role="alert">
          {imageError}
        </p>
      )}
      <div hidden={mode === "read"} className="no-print">
        {base && "spaceId" in base && base.kind === "DOCUMENT" && (
          <label className="field">
            {zh ? "父文档" : "Parent document"}
            <DocumentDrilldownPicker
              documents={snapshot.library}
              spaceId={base.spaceId!}
              documentId={base.id}
              value={base.parentDocumentId ?? null}
              disabled={busy || dirty}
              onChange={(parentDocumentId) => {
                void guarded(async () => {
                  const previous = baseRef.current;
                  if (!previous || !("spaceId" in previous)) return;
                  const saved = await runtime.saveLibrary(
                    previous.id,
                    previous.version,
                    {
                      kind: previous.kind,
                      spaceId: previous.spaceId,
                      title: previous.title,
                      bodyMd: previous.bodyMd,
                      parentDocumentId,
                      ...(previous.aliases
                        ? { aliases: previous.aliases }
                        : {}),
                      ...(previous.aiPolicy
                        ? { aiPolicy: previous.aiPolicy }
                        : {}),
                    },
                  );
                  baseRef.current = saved;
                  setBase(saved);
                  onSaved();
                });
              }}
            />
          </label>
        )}
        <LiveMarkdown
          wikiPages={scopedKnowledgeDocuments({
            ...snapshot,
            projectId: request.projectId,
            currentSpaceId: request.spaceId ?? undefined,
            workspaceId: runtime.context?.workspaceId,
            workspaceFallback: true,
          })}
          value={body}
          source={mode === "source"}
          label={library ? s("body") : t("noteBody")}
          onChange={setBody}
          onSave={() => void save(true)}
          onComposition={setComposing}
          editorRef={editor}
          onImages={insertImages}
        />
      </div>
      <div
        className={"document-reading " + (mode !== "read" ? "print-only" : "")}
      >
        <h1 className="print-only">{title}</h1>
        <Markdown text={body} />
      </div>
      {base && "day" in base && (
        <NoteKnowledgeActions
          note={base}
          snapshot={snapshot}
          runtime={runtime}
          disabled={busy || dirty}
          onChanged={onSaved}
          onPromoted={onWikiCreated}
          onOpenWiki={onWikiOpen}
        />
      )}
      {request.kind === "DOCUMENT" && base && (
        <WikiRelations
          documentId={base.id}
          snapshot={snapshot}
          onOpen={onWikiOpen}
          busy={busy}
          onCreate={(title) =>
            void guarded(async () => {
              const entity = await runtime.saveLibrary(null, 0, {
                kind: "DOCUMENT",
                spaceId: "spaceId" in base ? base.spaceId : null,
                title,
                bodyMd: "",
              });
              onSaved();
              onWikiCreated(entity);
            })
          }
        />
      )}
    </article>
  );
}
