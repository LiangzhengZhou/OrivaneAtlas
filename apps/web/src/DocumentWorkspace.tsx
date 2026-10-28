import {
  bodyLoaded,
  type LibraryEntry,
  type Note,
  privateContentPolicy,
  scopedKnowledgeDocuments,
  type WorkspaceLibraryEntry,
  type WorkspaceNote,
} from "@arclattice/application";
import type { LibraryFile } from "@arclattice/domain";
import type { EditorView } from "@codemirror/view";
import { Save } from "lucide-react";
import {
  type ComponentProps,
  memo,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { flushSync } from "react-dom";
import { useTranslation } from "react-i18next";
import { showToast } from "./app/ToastHost";
import type { Runtime, Snapshot } from "./bootstrap";
import { ContentPolicyEditor } from "./ContentPolicyEditor";
import { Button, SegmentedControl } from "./components/ui/Button";
import { confirmAction } from "./components/ui/ConfirmationHost";
import { exportHtml, exportMarkdownZip, exportPdf } from "./documentExports";
import { FilePicker } from "./FilePicker";
import {
  type EditorAtlasDraft,
  EditorAtlasFloat,
} from "./features/ai/EditorAtlasFloat";
import { DiffViewer } from "./features/documents/DiffViewer";
import { DocumentDrilldownPicker } from "./features/documents/DocumentDrilldownPicker";
import { DocumentPopover } from "./features/documents/DocumentPopover";
import { DocumentSaveStatus } from "./features/documents/DocumentSaveStatus";
import { mergeMarkdown } from "./features/documents/merge";
import { FileDetail, type FileDraft } from "./features/files/FileDetail";
import { fileMarkdownLink } from "./features/files/fileRoute";
import { DocumentSpaceActions } from "./features/knowledge/DocumentSpaceActions";
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
  entity?: WorkspaceNote | WorkspaceLibraryEntry | undefined;
  day?: string | undefined;
  spaceId?: string | null | undefined;
  projectId?: string | undefined;
};
export type FileRequest = {
  key: string;
  kind: "FILE";
  file: LibraryFile;
  entity?: undefined;
  day?: undefined;
  spaceId?: string | null | undefined;
  projectId?: string | undefined;
};
export type WorkspaceRequest = DocumentRequest | FileRequest;
type Tab = WorkspaceRequest & {
  fileDraft?: FileDraft;
  fileAtlasDraft?: import("./features/files/FileAtlasFloat").FileAtlasDraft;
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
  request: WorkspaceRequest | null;
  visible: boolean;
  runtime: Runtime;
  onChange: () => void;
  onBrowse: () => void;
  onVisibility: () => void;
  snapshot: Snapshot;
  onDirty: (dirty: boolean) => void;
  onActive: (request: WorkspaceRequest | null) => void;
}) {
  const { i18n } = useTranslation();
  const zh = i18n.language.startsWith("zh");
  const [tabs, setTabs] = useState<Tab[]>([]),
    [active, setActive] = useState("");
  const tabsRef = useRef(tabs);
  const tabStrip = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const strip = tabStrip.current;
    if (!strip) return;
    const reveal = () => {
      const selected = strip.querySelector<HTMLElement>(
        '[role="tab"][aria-selected="true"]',
      )?.parentElement;
      if (!selected) return;
      const item = selected.getBoundingClientRect(),
        bounds = strip.getBoundingClientRect();
      if (item.left < bounds.left) strip.scrollLeft -= bounds.left - item.left;
      else if (item.right > bounds.right)
        strip.scrollLeft += item.right - bounds.right;
    };
    reveal();
    const observer = new ResizeObserver(reveal);
    observer.observe(strip);
    // Font/style settling may resize preceding tabs without resizing the strip.
    // Keep the active identity visible after those intrinsic width changes too.
    for (const tab of strip.querySelectorAll(".document-tab"))
      observer.observe(tab);
    return () => observer.disconnect();
  }, [active, tabs.length, visible]);
  const closeHandlers = useRef(
    new Map<string, () => Promise<{ saved: boolean; draftStored: boolean }>>(),
  );
  tabsRef.current = tabs;
  const activeTab = visible
    ? (tabs.find((tab) => tab.key === active) ?? null)
    : null;
  const filesById = useMemo(
    () => new Map((snapshot.files ?? []).map((file) => [file.id, file])),
    [snapshot.files],
  );
  const activeFile =
    activeTab?.kind === "FILE"
      ? (filesById.get(activeTab.file.id) ?? activeTab.file)
      : null;
  const fileTitle = (tab: Tab) =>
    tab.kind === "FILE" ? (filesById.get(tab.file.id) ?? tab.file).name : "";
  // Shell context contains identity and saved entity metadata, not tab status.
  // Dirty/busy/title edits stay in this workspace until the entity is saved.
  const activeContext = useMemo<WorkspaceRequest | null>(
    () =>
      activeTab
        ? activeTab.kind === "FILE"
          ? {
              key: activeTab.key,
              kind: "FILE",
              file: activeFile!,
              spaceId: activeTab.spaceId,
              projectId: activeTab.projectId,
            }
          : {
              key: activeTab.key,
              kind: activeTab.kind,
              entity: activeTab.entity,
              day: activeTab.day,
              spaceId: activeTab.spaceId,
              projectId: activeTab.projectId,
            }
        : null,
    [
      activeTab?.key,
      activeTab?.kind,
      activeTab?.entity,
      activeTab?.day,
      activeTab?.spaceId,
      activeTab?.projectId,
      activeFile,
    ],
  );
  useEffect(() => onActive(activeContext), [activeContext, onActive]);
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
  async function close(tab: Tab) {
    if (tab.busy) return;
    const prepared = tab.dirty
      ? await closeHandlers.current.get(tab.key)?.()
      : undefined;
    if (
      tab.dirty &&
      !prepared?.saved &&
      !(await confirmAction(
        prepared?.draftStored
          ? zh
            ? "未能保存到本机数据库，本地草稿已保留。关闭此标签？"
            : "Could not save to the local database. Your local draft is retained. Close this tab?"
          : zh
            ? "尚有未保存内容，关闭将丢弃此草稿。是否关闭？"
            : "Unsaved draft will be lost. Close this tab?",
      ))
    )
      return;
    const next = tabsRef.current.filter((t) => t.key !== tab.key);
    setTabs(next);
    if (active === tab.key) setActive(next.at(-1)?.key ?? "");
    if (!next.length) onBrowse();
  }
  return (
    <section className="document-workspace" hidden={!tabs.length}>
      <div
        ref={tabStrip}
        className="document-tabs no-print"
        role="tablist"
        aria-label={zh ? "打开的文档" : "Open documents"}
      >
        <Button type="button" variant="toggle" onClick={onBrowse}>
          {zh ? "工作台" : "Workspace"}
        </Button>
        {tabs.map((tab) => (
          <div className="document-tab" key={tab.key}>
            <Button
              type="button"
              role="tab"
              aria-selected={visible && active === tab.key}
              onClick={() => {
                setActive(tab.key);
                onVisibility();
              }}
            >
              <span className="document-tab-label">
                {tab.dirty ? "● " : ""}
                {tab.title ||
                  fileTitle(tab) ||
                  tab.entity?.title ||
                  tab.day ||
                  (zh ? "未命名" : "Untitled")}
              </span>
            </Button>
            <Button
              type="button"
              aria-label={
                (zh ? "关闭 " : "Close ") +
                (tab.title ||
                  fileTitle(tab) ||
                  tab.entity?.title ||
                  tab.day ||
                  "")
              }
              onClick={() => close(tab)}
              disabled={tab.busy}
            >
              ×
            </Button>
          </div>
        ))}
      </div>
      {tabs.map((tab) => (
        <div key={tab.key} hidden={!visible || active !== tab.key}>
          {tab.kind === "FILE" ? (
            visible &&
            active === tab.key && (
              <FileDetail
                file={filesById.get(tab.file.id) ?? tab.file}
                snapshot={snapshot}
                runtime={runtime}
                draft={tab.fileDraft}
                atlasDraft={tab.fileAtlasDraft}
                onAtlasDraft={(draft) =>
                  setTabs((old) =>
                    old.map((entry) =>
                      entry.key === tab.key
                        ? { ...entry, fileAtlasDraft: draft }
                        : entry,
                    ),
                  )
                }
                onChanged={async () => {
                  await onChange();
                }}
                onClose={() => {
                  void close({ ...tab, dirty: false, busy: false });
                }}
                onOpenDocument={(entity) => {
                  const key = `DOCUMENT:${entity.id}`;
                  setTabs((old) =>
                    old.some((entry) => entry.key === key)
                      ? old
                      : [
                          ...old,
                          {
                            key,
                            kind: "DOCUMENT",
                            entity,
                            spaceId: entity.spaceId,
                          },
                        ],
                  );
                  setActive(key);
                  onVisibility();
                }}
                onStatus={(draft, dirty, busy) =>
                  setTabs((old) => {
                    const current = old.find((entry) => entry.key === tab.key);
                    const previous = current?.fileDraft;
                    if (
                      current?.dirty === dirty &&
                      current.busy === busy &&
                      previous?.name === draft.name &&
                      previous.policy.aiAccess === draft.policy.aiAccess &&
                      previous.policy.classification ===
                        draft.policy.classification &&
                      previous.policy.processingBoundary ===
                        draft.policy.processingBoundary
                    )
                      return old;
                    return old.map((entry) =>
                      entry.key === tab.key
                        ? { ...entry, fileDraft: draft, dirty, busy }
                        : entry,
                    );
                  })
                }
              />
            )
          ) : (
            <HydratedDocumentPane
              active={visible && active === tab.key}
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
                onVisibility();
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
              onRegisterClose={(handler) => {
                if (handler) closeHandlers.current.set(tab.key, handler);
                else closeHandlers.current.delete(tab.key);
              }}
              runtime={runtime}
              remote={[...snapshot.notes, ...snapshot.library].find(
                (e) => e.id === tab.entity?.id,
              )}
              onSaved={onChange}
              onClose={() => close({ ...tab, dirty: false, busy: false })}
              onStatus={(dirty, title, entity, busy) =>
                setTabs((old) =>
                  old.map((t) =>
                    t.kind !== "FILE" &&
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
          )}
        </div>
      ))}
    </section>
  );
}
function HydratedDocumentPane(
  props: Omit<ComponentProps<typeof DocumentPane>, "request" | "remote"> & {
    request: DocumentRequest;
    remote: WorkspaceNote | WorkspaceLibraryEntry | undefined;
  },
) {
  const { i18n } = useTranslation();
  const zh = i18n.language.startsWith("zh");
  const source = props.remote ?? props.request.entity;
  const [loaded, setLoaded] = useState<Note | LibraryEntry | undefined>(() =>
    source && bodyLoaded(source) ? source : undefined,
  );
  // A new local draft already owns its editor. Its first saved metadata must
  // not replace that pane with a loading screen while an upload is in flight.
  const paneInitialized = useRef(!source || bodyLoaded(source));
  const [failed, setFailed] = useState(false);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    if (!props.active || !source) return;
    if (bodyLoaded(source)) {
      setLoaded(source);
      setFailed(false);
      return;
    }
    let active = true;
    setFailed(false);
    void props.runtime.readDocumentBody(source).then(
      (entity) => {
        if (active) setLoaded(entity);
      },
      () => {
        if (active) setFailed(true);
      },
    );
    return () => {
      active = false;
    };
  }, [props.active, props.runtime, source, retry]);
  if (source && !loaded && !paneInitialized.current) {
    if (!props.active) return null;
    return (
      <div className="document-loading" role="status">
        {failed ? (
          <>
            <p>
              {zh
                ? "未能加载正文，草稿未改变。"
                : "Could not load the document. Your draft is unchanged."}
            </p>
            <Button onClick={() => setRetry((value) => value + 1)}>
              {zh ? "重试" : "Retry"}
            </Button>
          </>
        ) : zh ? (
          "正在加载正文…"
        ) : (
          "Loading document…"
        )}
      </div>
    );
  }
  paneInitialized.current = true;
  return (
    <FrozenDocumentPane
      {...props}
      request={{ ...props.request, entity: loaded }}
      remote={loaded}
    />
  );
}

// Retain local editor/draft state, but defer workspace and callback updates while
// inactive. The next activation receives the latest props for conflict checks.
// Local save completion still updates the pane's own state normally.
const FrozenDocumentPane = memo(
  DocumentPane,
  (previous, next) => !previous.active && !next.active,
);

function DocumentPane({
  active,
  snapshot,
  onWikiCreated,
  onWikiOpen,
  request,
  runtime,
  onSaved,
  onClose,
  onStatus,
  remote,
  onRegisterClose,
}: {
  active: boolean;
  snapshot: Snapshot;
  onWikiCreated(entity: LibraryEntry): void;
  onWikiOpen(id: string): void;
  request: Omit<DocumentRequest, "entity"> & {
    entity?: Note | LibraryEntry | undefined;
  };
  runtime: Runtime;
  onSaved: () => void;
  onClose: () => void;
  remote: Note | LibraryEntry | undefined;
  onRegisterClose(
    handler: (() => Promise<{ saved: boolean; draftStored: boolean }>) | null,
  ): void;
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
  const [editorPending, setEditorPending] = useState(false);
  const editorPendingRef = useRef(false);
  const [printing, setPrinting] = useState(false);
  const readingBody = useRef<string | null>(null);
  useEffect(() => {
    if (!active) return;
    const prepare = () =>
      flushSync(() => {
        setBody(editor.current?.state.doc.toString() ?? current.current.body);
        setPrinting(true);
      });
    const finish = () => setPrinting(false);
    window.addEventListener("beforeprint", prepare);
    window.addEventListener("afterprint", finish);
    return () => {
      window.removeEventListener("beforeprint", prepare);
      window.removeEventListener("afterprint", finish);
    };
  }, [active]);
  const wikiPages = useMemo(
    () =>
      scopedKnowledgeDocuments({
        ...snapshot,
        projectId: request.projectId,
        currentSpaceId: request.spaceId ?? undefined,
        workspaceId: runtime.context?.workspaceId,
        workspaceFallback: true,
      }),
    [
      snapshot,
      request.projectId,
      request.spaceId,
      runtime.context?.workspaceId,
    ],
  );
  const [aiPolicy, setAiPolicy] = useState(
    request.entity?.aiPolicy ?? privateContentPolicy,
  );
  const [mode, setMode] = useState<"live" | "source" | "read">("live"),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [composing, setComposing] = useState(false),
    [history, setHistory] = useState<(Note | LibraryEntry)[]>([]);
  const [historyOpenRequest, setHistoryOpenRequest] = useState(0);
  if (mode === "read" || printing) readingBody.current = body;
  const [username, setUsername] = useState(""),
    [password, setPassword] = useState("");
  const editor = useRef<EditorView | null>(null),
    gate = useRef(false),
    failed = useRef(false),
    baseRef = useRef(base);
  const attachmentInput = useRef<HTMLInputElement | null>(null);
  async function attachOriginal(file: File) {
    const view = editor.current,
      document = view?.state.doc,
      selection = view?.state.selection.main,
      base = baseRef.current;
    if (!view || !document || !selection || busy) return;
    setBusy(true);
    try {
      const original = await runtime.uploadFile(
        {
          name: file.name,
          mime: file.type || "application/octet-stream",
          spaceId:
            base && "spaceId" in base
              ? base.kind === "SPACE"
                ? base.id
                : base.spaceId
              : null,
          parentDocumentId:
            base && "spaceId" in base && base.kind === "DOCUMENT"
              ? base.id
              : null,
        },
        file,
      );
      const reference = fileMarkdownLink(original);
      if (
        editor.current !== view ||
        view.state.doc !== document ||
        document.length - (selection.to - selection.from) + reference.length >
          200000
      ) {
        showToast(
          zh
            ? "原文件已保存；正文已改变，请从资料库复制文件引用。"
            : "Original saved. The text changed; copy its reference from the Library.",
        );
      } else {
        view.dispatch({
          changes: {
            from: selection.from,
            to: selection.to,
            insert: reference,
          },
          selection: { anchor: selection.from + reference.length },
          userEvent: "input.file",
        });
      }
      onSaved();
    } catch {
      setError(
        zh
          ? "文件上传失败，正文未改变。"
          : "File upload failed. The text is unchanged.",
      );
    } finally {
      setBusy(false);
    }
  }
  const [editorAtlasOpen, setEditorAtlasOpen] = useState(false);
  const [editorAtlasDraft, setEditorAtlasDraft] = useState<
    EditorAtlasDraft | undefined
  >();
  const current = useRef({ title, body, composing, aiPolicy });
  current.current = { title, body, composing, aiPolicy };
  const callbacks = useRef({ onStatus, onSaved });
  callbacks.current = { onStatus, onSaved };
  const library = request.kind === "SPACE" || request.kind === "DOCUMENT";
  const dirty =
    editorPending ||
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
      return false;
    const draft = {
        ...current.current,
        body: editorPendingRef.current
          ? (editor.current?.state.doc.toString() ?? current.current.body)
          : current.current.body,
      },
      previous = baseRef.current;
    if (request.kind === "NOTE" && !draft.title.trim() && draft.body.trim()) {
      draft.title = draft.body
        .trim()
        .split(/\r?\n/, 1)[0]!
        .replace(/^#{1,6}\s+/, "")
        .slice(0, 240);
      setTitle(draft.title);
    }
    if (previous?.deletedAt) {
      failed.current = true;
      setError("NOT_FOUND");
      return false;
    }
    if (
      (!draft.title.trim() && request.kind !== "DOCUMENT") ||
      (!previous && !draft.body.trim() && request.kind === "JOURNAL")
    )
      return false;
    if (
      previous &&
      draft.title === previous.title &&
      draft.body === previous.bodyMd &&
      JSON.stringify(draft.aiPolicy) ===
        JSON.stringify(previous.aiPolicy ?? privateContentPolicy)
    )
      return true;
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
                  spaceId:
                    baseRef.current && "spaceId" in baseRef.current
                      ? baseRef.current.spaceId
                      : (request.spaceId ?? null),
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
      return true;
    } catch (cause) {
      failed.current = true;
      setError((cause as { code?: string }).code ?? "UNAVAILABLE");
      return false;
    } finally {
      gate.current = false;
      setBusy(false);
    }
  }
  const saver = useRef(save);
  saver.current = save;
  useEffect(() => {
    onRegisterClose(async () => {
      const saved = await saver.current(true);
      if (saved) return { saved: true, draftStored: false };
      const draft = current.current;
      if (
        draft.aiPolicy.classification === "SENSITIVE" ||
        draft.aiPolicy.classification === "SECRET"
      ) {
        return { saved: false, draftStored: false };
      }
      const draftStored = await saveDraft(draftKey, {
        title: draft.title,
        body: editor.current?.state.doc.toString() ?? draft.body,
        updatedAt: Date.now(),
        savedAt: Date.now(),
        entityId: baseRef.current?.id ?? request.key,
        baseVersion: baseRef.current?.version ?? 0,
        baseUpdatedAt: baseRef.current?.updatedAt ?? null,
      });
      return { saved: false, draftStored };
    });
    return () => onRegisterClose(null);
  }, [onRegisterClose, draftKey, request.key]);
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
        const currentView = editor.current;
        if (currentView !== view) {
          const draftBody =
            currentView?.state.doc.toString() ?? current.current.body;
          if (draftBody !== view.state.doc.toString()) {
            setImageError(
              zh
                ? "正文已改变，图片未插入。请重新选择图片。"
                : "The document changed. Image not inserted; please select it again.",
            );
            return;
          }
          const insertedBody =
            draftBody.slice(0, position) + insert + draftBody.slice(position);
          if (currentView)
            currentView.dispatch({ changes: { from: position, insert } });
          current.current.body = insertedBody;
          setBody(insertedBody);
          return;
        }
        view.dispatch({
          changes: { from: position, insert },
          effects: imageAnchor.of(null),
        });
        // Upload completion can unmount an inactive editor before its debounce.
        // Publish this asynchronous insertion before releasing the busy gate.
        const insertedBody = view.state.doc.toString();
        current.current.body = insertedBody;
        setBody(insertedBody);
      } catch (cause) {
        setImageError(
          zh
            ? "图片未能保存到本机，请检查图片格式或本机存储后重试。正文未被替换。"
            : "Could not save the image on this device. Check its format or device storage and retry. Your text was not replaced.",
        );
        throw cause;
      } finally {
        if (editor.current === view)
          view.dispatch({ effects: imageAnchor.of(null) });
      }
    });
  }
  if (!active && !busy) return null;
  return (
    <article
      className="document-pane"
      onKeyDown={(event) => {
        if (
          !event.defaultPrevented &&
          (event.ctrlKey || event.metaKey) &&
          event.key.toLowerCase() === "s"
        ) {
          event.preventDefault();
          void save(true);
        }
      }}
    >
      <div className="document-toolbar no-print">
        <SegmentedControl
          label={zh ? "文档视图" : "Document view"}
          value={mode === "read" ? "read" : "edit"}
          options={[
            { value: "edit", label: zh ? "编辑" : "Edit" },
            { value: "read", label: t("read") },
          ]}
          onChange={(value) => setMode(value === "read" ? "read" : "live")}
        />
        <DocumentPopover
          className="document-mode-menu"
          label={<>Markdown ▾</>}
          closeOnClick
        >
          {(["live", "source"] as const).map((value) => (
            <Button
              key={value}
              type="button"
              variant="toggle"
              aria-pressed={mode === value}
              onClick={() => setMode(value)}
            >
              {value === "live"
                ? zh
                  ? "实时预览"
                  : "Live preview"
                : zh
                  ? "源码"
                  : "Source"}
            </Button>
          ))}
        </DocumentPopover>
        <span className="action-spacer" />
        <span
          className="document-atlas-action"
          style={mode === "read" ? { visibility: "hidden" } : undefined}
          aria-hidden={mode === "read" || undefined}
        >
          <Button
            variant="ghost"
            disabled={mode === "read"}
            onClick={() => setEditorAtlasOpen(true)}
          >
            {zh ? "询问 Atlas" : "Ask Atlas"}
          </Button>
        </span>
        <Button
          variant="ghost"
          disabled={busy}
          title={zh ? "保存 (Ctrl/⌘+S)" : "Save (Ctrl/⌘+S)"}
          onClick={() => void save(true)}
        >
          <Save size={16} />
          {zh ? "保存" : "Save"}
        </Button>
        <DocumentSaveStatus
          runtime={runtime}
          id={base?.id}
          library={library}
          dirty={dirty}
          busy={busy}
          error={!!error}
          zh={zh}
        />
        <DocumentPopover className="document-actions-menu" label={<>···</>}>
          <DocumentPopover
            className="document-export"
            label={zh ? "导出" : "Export"}
          >
            <Button
              variant="toggle"
              type="button"
              onClick={() => downloadText((title || "document") + ".md", body)}
            >
              {t("exportMarkdown")}
            </Button>
            <Button variant="toggle" type="button" onClick={exportPdf}>
              {s("pdf")}
            </Button>
            <Button
              variant="toggle"
              type="button"
              onClick={() =>
                void exportHtml(title || "document", body, runtime.loadImage)
              }
            >
              {zh ? "导出 HTML" : "Export HTML"}
            </Button>
            <Button
              variant="toggle"
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
            </Button>
          </DocumentPopover>
          {base && (
            <Button
              variant="toggle"
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
            </Button>
          )}
          {base && (
            <Button
              variant="toggle"
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
            </Button>
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
                onFile={async (file) => {
                  if (dirty && !(await confirmAction(s("leave")))) return;
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
                    ? "PNG / JPEG / WebP · 原图先保存到本机"
                    : "PNG / JPEG / WebP · Originals saved on this device first"
                }
                disabled={busy || !!base?.deletedAt}
                accept="image/png,image/jpeg,image/webp"
                onFile={(file) => insertImages([file])}
              />
            </div>
            <p className="upload-hint">
              {zh
                ? "也可直接粘贴图片（Ctrl/⌘ V）。原图先保存到本机，连接工作区后在后台同步。Markdown ZIP 可包含原图。"
                : "Paste images with Ctrl/⌘ V. Originals are saved on this device first and sync in the background when connected. Markdown ZIP can include originals."}
            </p>
            {history.map((revision) => (
              <details key={revision.version}>
                <summary>
                  v{revision.version} · {revision.updatedAt}
                </summary>
                <DiffViewer before={revision.bodyMd} after={body} />
                <Button
                  variant="toggle"
                  type="button"
                  onClick={() => {
                    setTitle(revision.title);
                    setBody(revision.bodyMd);
                    setHistory([]);
                  }}
                >
                  {t("useRevision")}
                </Button>
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
          <Button
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
          </Button>
        </div>
      )}
      {error && (
        <div className="error no-print" role="alert">
          <strong>{error}</strong>
          {recoveryRequired.current && !base && (
            <Button
              type="button"
              disabled={busy}
              onClick={async () => {
                if (
                  !(await confirmAction(
                    zh
                      ? "将恢复的草稿保存为新文档？"
                      : "Save the recovered draft as a new document?",
                  ))
                )
                  return;
                recoveryRequired.current = false;
                failed.current = false;
                void save(true);
              }}
            >
              {zh ? "确认恢复并保存" : "Confirm recovery and save"}
            </Button>
          )}
          {error === "VERSION_CONFLICT" && remote && (
            <details>
              <summary>
                {zh ? "对照远端版本" : "Compare remote version"}
              </summary>
              <h3>{remote.title}</h3>
              <Markdown text={remote.bodyMd} />
              <DiffViewer before={remote.bodyMd} after={body} />
              <Button
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
              </Button>
              <Button
                type="button"
                disabled={busy || !!remote.deletedAt}
                onClick={async () => {
                  if (
                    !(await confirmAction(
                      zh
                        ? "将当前草稿作为合并结果，在远端最新版本上保存？请先检查差异。"
                        : "Save the current draft as your merged result on the latest remote version? Review differences first.",
                    ))
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
              </Button>
              <Button
                type="button"
                disabled={busy}
                onClick={async () => {
                  if (
                    !(await confirmAction(
                      zh
                        ? "丢弃本地草稿并载入远端版本？"
                        : "Discard local draft and load remote version?",
                    ))
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
              </Button>
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
              <Button type="submit" disabled={busy}>
                {s("login")}
              </Button>
            </form>
          )}
        </div>
      )}
      <input
        className="document-title no-print"
        aria-label={
          library
            ? s(request.kind === "SPACE" ? "spaceTitle" : "title")
            : request.kind === "JOURNAL"
              ? zh
                ? "日记标题"
                : "Journal title"
              : t("noteTitle")
        }
        maxLength={240}
        placeholder={
          library
            ? request.kind === "SPACE"
              ? s("spaceTitle")
              : zh
                ? "未命名文档"
                : "Untitled document"
            : request.kind === "JOURNAL"
              ? zh
                ? "日记标题"
                : "Journal title"
              : t("noteTitle")
        }
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
          onAttachFile={() => attachmentInput.current?.click()}
          onAtlas={() => setEditorAtlasOpen(true)}
          onPendingChange={(pending) => {
            editorPendingRef.current = pending;
            setEditorPending(pending);
          }}
          wikiPages={wikiPages}
          value={body}
          source={mode === "source"}
          label={library ? s("body") : t("noteBody")}
          onChange={(text) => {
            current.current.body = text;
            setBody(text);
          }}
          onSave={() => void save(true)}
          onComposition={setComposing}
          editorRef={editor}
          onImages={insertImages}
        />
      </div>
      <input
        ref={attachmentInput}
        type="file"
        hidden
        aria-label={zh ? "附加原文件" : "Attach original file"}
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) void attachOriginal(file);
        }}
      />
      {editorAtlasOpen && editor.current && mode !== "read" && (
        <EditorAtlasFloat
          draft={editorAtlasDraft}
          onDraft={setEditorAtlasDraft}
          runtime={runtime}
          editor={editor.current}
          identity={{
            documentId: base?.id ?? request.key,
            version: base?.version ?? 0,
            kind:
              request.kind === "SPACE"
                ? "SPACE"
                : request.kind === "DOCUMENT"
                  ? "DOCUMENT"
                  : "NOTE",
          }}
          policy={aiPolicy}
          zh={zh}
          onClose={() => setEditorAtlasOpen(false)}
        />
      )}
      {readingBody.current !== null && (
        <div
          className={
            "document-reading " + (mode !== "read" ? "print-only" : "")
          }
        >
          <h1 className="print-only">{title}</h1>
          <Markdown text={readingBody.current} />
        </div>
      )}
      {base && "spaceId" in base && base.kind === "DOCUMENT" && (
        <DocumentSpaceActions
          document={base}
          runtime={runtime}
          snapshot={snapshot}
          disabled={busy || dirty}
          zh={zh}
          onMoved={(saved) => {
            baseRef.current = saved;
            setBase(saved);
          }}
          onChanged={onSaved}
        />
      )}
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
      {active && request.kind === "DOCUMENT" && base && (
        <WikiRelations
          runtime={runtime}
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
