import type { LibraryEntry, Note } from "@arclattice/application";
import type { EditorView } from "@codemirror/view";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { Runtime, Snapshot } from "./bootstrap";
import { LiveMarkdown } from "./LiveMarkdown";
import { clearDraft, loadDraft, saveDraft } from "./localDrafts";
import { Markdown } from "./Markdown";
import { downloadText } from "./NoteEditor";

export type DocumentRequest = {
  key: string;
  kind: "NOTE" | "JOURNAL" | "SPACE" | "DOCUMENT";
  entity?: Note | LibraryEntry | undefined;
  day?: string | undefined;
  spaceId?: string | null | undefined;
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
}: {
  request: DocumentRequest | null;
  visible: boolean;
  runtime: Runtime;
  onChange: () => void;
  onBrowse: () => void;
  onVisibility: () => void;
  snapshot: Snapshot;
  onDirty: (dirty: boolean) => void;
}) {
  const { i18n } = useTranslation();
  const zh = i18n.language.startsWith("zh");
  const [tabs, setTabs] = useState<Tab[]>([]),
    [active, setActive] = useState("");
  const tabsRef = useRef(tabs);
  tabsRef.current = tabs;
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
  request,
  runtime,
  onSaved,
  onClose,
  onStatus,
  remote,
}: {
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
  const [mode, setMode] = useState<"live" | "source" | "read">("live"),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [composing, setComposing] = useState(false),
    [history, setHistory] = useState<(Note | LibraryEntry)[]>([]);
  const [username, setUsername] = useState(""),
    [password, setPassword] = useState("");
  const editor = useRef<EditorView | null>(null),
    gate = useRef(false),
    failed = useRef(false),
    baseRef = useRef(base);
  const current = useRef({ title, body, composing });
  current.current = { title, body, composing };
  const callbacks = useRef({ onStatus, onSaved });
  callbacks.current = { onStatus, onSaved };
  const library = request.kind === "SPACE" || request.kind === "DOCUMENT";
  const dirty =
    title !== (base?.title ?? request.day ?? "") ||
    body !== (base?.bodyMd ?? "");
  const draftKey = [
    runtime.context?.workspaceId ?? "unknown",
    runtime.context?.principalId ?? "unknown",
    request.key,
  ].join(":");
  const restored = useRef(false);
  useEffect(() => {
    restored.current = false;
    void loadDraft(draftKey).then((draft) => {
      if (!draft) {
        restored.current = true;
        return;
      }
      setTitle(draft.title);
      setBody(draft.body);
      restored.current = true;
    });
  }, [draftKey]);
  useEffect(() => {
    if (!restored.current || !dirty) return;
    const timer = setTimeout(
      () => void saveDraft(draftKey, { title, body, updatedAt: Date.now() }),
      250,
    );
    return () => clearTimeout(timer);
  }, [draftKey, title, body, dirty]);
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
  }, [remote, base, busy, dirty, composing]);
  async function save(explicit = false) {
    if (
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
      draft.body === previous.bodyMd
    )
      return;
    gate.current = true;
    setBusy(true);
    setError("");
    try {
      const value = library
        ? await runtime.saveLibrary(
            previous?.id ?? null,
            previous?.version ?? 0,
            {
              kind: request.kind as "SPACE" | "DOCUMENT",
              spaceId: request.spaceId ?? null,
              title: draft.title,
              bodyMd: draft.body,
            },
          )
        : await runtime.saveNote(previous?.id ?? null, previous?.version ?? 0, {
            kind: request.kind as "NOTE" | "JOURNAL",
            day:
              request.kind === "JOURNAL"
                ? (request.day ?? (previous as Note)?.day ?? null)
                : null,
            title: draft.title,
            bodyMd: draft.body,
          });
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
  }, [title, body, dirty, composing, busy]);
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
  return (
    <article className="document-pane">
      <div className="document-toolbar no-print">
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
        <button
          className="button secondary"
          type="button"
          disabled={busy}
          onClick={() => void save(true)}
        >
          {c("save")}
        </button>
        <button
          className="chip"
          type="button"
          onClick={() => downloadText((title || "document") + ".md", body)}
        >
          {t("exportMarkdown")}
        </button>
        <button className="chip" type="button" onClick={() => window.print()}>
          {s("pdf")}
        </button>
        {base && (
          <button
            className="chip"
            type="button"
            disabled={busy}
            onClick={() =>
              void guarded(async () =>
                setHistory(
                  history.length
                    ? []
                    : await (library
                        ? runtime.libraryRevisions(base.id)
                        : runtime.revisions(base.id)),
                ),
              )
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
              if (
                !window.confirm(
                  zh ? "将文档移入回收站？" : "Move document to trash?",
                )
              )
                return;
              void guarded(async () => {
                await (library
                  ? runtime.deleteLibrary(base.id, base.version, true)
                  : runtime.deleteNote(base.id, base.version, true));
                onSaved();
                onClose();
              });
            }}
          >
            {c("delete")}
          </button>
        )}
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
          {error === "VERSION_CONFLICT" && remote && (
            <details>
              <summary>
                {zh ? "对照远端版本" : "Compare remote version"}
              </summary>
              <h3>{remote.title}</h3>
              <Markdown text={remote.bodyMd} />
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
      <div className="document-meta no-print">
        {request.kind} {request.day} ·{" "}
        {base ? "v" + base.version : zh ? "草稿" : "Draft"} ·{" "}
        {t("characters", { count: body.length })} ·{" "}
        {zh
          ? "私人文档 · AI 默认不读取"
          : "Private · AI does not read by default"}
      </div>
      <details className="document-tools no-print">
        <summary>
          {zh ? "导入、图片与修订" : "Import, images and revisions"}
        </summary>
        <label>
          {t("importMarkdown")}
          <input
            type="file"
            accept=".md,.markdown,.txt"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (!file) return;
              if (dirty && !window.confirm(s("leave"))) return;
              void guarded(async () => {
                if (file.size > 600000) throw new Error("size");
                const value = new TextDecoder("utf-8", { fatal: true }).decode(
                  await file.arrayBuffer(),
                );
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
        </label>
        {request.spaceId && (
          <label>
            {s("image")}
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (!file) return;
                void guarded(async () => {
                  const asset = await runtime.uploadImage(
                    request.spaceId!,
                    file,
                  );
                  const view = editor.current;
                  if (view)
                    view.dispatch(
                      view.state.replaceSelection("\n![](" + asset.url + ")\n"),
                    );
                });
              }}
            />
          </label>
        )}
        {history.map((revision) => (
          <details key={revision.version}>
            <summary>
              v{revision.version} · {revision.updatedAt}
            </summary>
            <Markdown text={revision.bodyMd} />
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
      </details>
      <div hidden={mode === "read"} className="no-print">
        <LiveMarkdown
          value={body}
          source={mode === "source"}
          label={library ? s("body") : t("noteBody")}
          onChange={setBody}
          onSave={() => void save(true)}
          onComposition={setComposing}
          editorRef={editor}
        />
      </div>
      <div
        className={"document-reading " + (mode !== "read" ? "print-only" : "")}
      >
        <h1 className="print-only">{title}</h1>
        <Markdown text={body} />
      </div>
      <p className="document-footnote no-print">
        {zh
          ? "停笔 1 秒自动保存 · Ctrl/⌘ S 立即保存 · 未保存草稿仅保留在当前页面内存中"
          : "Autosave after 1s · Ctrl/⌘ S to save · Unsaved drafts live only in this page’s memory"}
      </p>
    </article>
  );
}
