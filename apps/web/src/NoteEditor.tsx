import type { Note, NoteInput } from "@arclattice/application";
import { Download, History, ShieldCheck, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { Runtime } from "./bootstrap";
import { Markdown } from "./Markdown";
export function downloadText(
  name: string,
  text: string,
  type = "text/markdown;charset=utf-8",
) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function NoteEditor({
  note,
  kind,
  day,
  runtime,
  busy,
  error,
  onClose,
  onSave,
  onDelete,
}: {
  note: Note | null;
  kind: "NOTE" | "JOURNAL";
  day: string;
  runtime: Runtime;
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onSave: (input: NoteInput) => Promise<void>;
  onDelete: () => Promise<void>;
}) {
  const { t } = useTranslation("desk");
  const { t: common } = useTranslation("common");
  const [title, setTitle] = useState(
    note?.title ?? (kind === "JOURNAL" ? day : ""),
  );
  const [body, setBody] = useState(note?.bodyMd ?? "");
  const [preview, setPreview] = useState(false);
  const [history, setHistory] = useState<Note[] | null>(null);
  const [historyError, setHistoryError] = useState(false);
  const [discard, setDiscard] = useState(false);
  const [importError, setImportError] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const dirty =
    title !== (note?.title ?? (kind === "JOURNAL" ? day : "")) ||
    body !== (note?.bodyMd ?? "");
  function close() {
    if (dirty) setDiscard(true);
    else onClose();
  }
  useEffect(() => {
    const node = dialog.current;
    node?.showModal();
    return () => node?.close();
  }, []);
  useEffect(() => {
    const handler = (event: BeforeUnloadEvent) => {
      if (dirty) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);
  return (
    <dialog
      ref={dialog}
      className="note-dialog task-dialog"
      aria-labelledby="note-heading"
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) close();
      }}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (!busy)
            void onSave({
              title,
              bodyMd: body,
              kind: note?.kind ?? kind,
              day: note?.day ?? (kind === "JOURNAL" ? day : null),
            });
        }}
      >
        <div className="dialog-heading">
          <h2 id="note-heading">
            {t(kind === "JOURNAL" ? "journal" : "notes")}
          </h2>
          <button
            type="button"
            className="icon-button"
            aria-label={common("close")}
            onClick={close}
            disabled={busy}
          >
            <X size={20} />
          </button>
        </div>
        <p className="privacy-line">
          <ShieldCheck size={15} />
          {t("notePrivacy")}
        </p>
        {!note && kind === "NOTE" && !body && !title && (
          <label className="field import-field">
            <span>{t("importMarkdown")}</span>
            <input
              type="file"
              aria-label={t("importMarkdown")}
              accept=".md,.markdown,.txt"
              disabled={busy}
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (!file) return;
                setImportError(false);
                if (
                  file.size > 600000 ||
                  !/\.(md|markdown|txt)$/i.test(file.name)
                ) {
                  setImportError(true);
                  return;
                }
                void file
                  .arrayBuffer()
                  .then((buffer) => {
                    const text = new TextDecoder("utf-8", {
                      fatal: true,
                    }).decode(buffer);
                    if (text.length > 200000) throw new Error("size");
                    setBody(text);
                    setTitle(
                      file.name
                        .replace(/\.(md|markdown|txt)$/i, "")
                        .slice(0, 240),
                    );
                    setPreview(false);
                  })
                  .catch(() => setImportError(true));
              }}
            />
            <small>{t("importHint")}</small>
          </label>
        )}
        {importError && (
          <p className="error" role="alert">
            {t("importError")}
          </p>
        )}
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        {discard && (
          <div className="error">
            {t("discardHint")}
            <button className="button danger" type="button" onClick={onClose}>
              {t("discard")}
            </button>
            <button
              className="button secondary"
              type="button"
              onClick={() => setDiscard(false)}
            >
              {common("cancel")}
            </button>
          </div>
        )}
        <input
          className="note-title-input"
          aria-label={t("noteTitle")}
          required
          maxLength={240}
          placeholder={t("noteTitle")}
          value={title}
          onChange={(event) => setTitle(event.target.value)}
        />
        <div className="editor-toolbar">
          <button
            className={!preview ? "chip active" : "chip"}
            type="button"
            onClick={() => setPreview(false)}
          >
            {t("write")}
          </button>
          <button
            className={preview ? "chip active" : "chip"}
            type="button"
            onClick={() => setPreview(true)}
          >
            {t("read")}
          </button>
          <span className="action-spacer" />
          <button
            type="button"
            className="icon-button"
            aria-label={t("exportMarkdown")}
            onClick={() => downloadText((title || "note") + ".md", body)}
          >
            <Download size={17} />
          </button>
          {note && (
            <button
              className="icon-button"
              type="button"
              aria-label={t("revisions")}
              onClick={() => {
                if (history) {
                  setHistory(null);
                  return;
                }
                setHistoryError(false);
                void runtime
                  .revisions(note.id)
                  .then(setHistory)
                  .catch(() => setHistoryError(true));
              }}
            >
              <History size={17} />
            </button>
          )}
        </div>
        {historyError && (
          <p className="error" role="alert">
            {common("unexpected")}
          </p>
        )}
        {history && (
          <section className="revision-list">
            <h3>{t("revisions")}</h3>
            {history.map((revision) => (
              <details key={revision.version}>
                <summary>
                  {common("version", { version: revision.version })} ·{" "}
                  {new Date(revision.updatedAt).toLocaleString()}
                </summary>
                <pre>{revision.bodyMd}</pre>
                <button
                  type="button"
                  className="button secondary"
                  onClick={() => {
                    setTitle(revision.title);
                    setBody(revision.bodyMd);
                    setHistory(null);
                    setPreview(false);
                  }}
                >
                  {t("useRevision")}
                </button>
              </details>
            ))}
          </section>
        )}
        {preview ? (
          <Markdown text={body} />
        ) : (
          <textarea
            className="note-body"
            aria-label={t("noteBody")}
            placeholder={t("notePlaceholder")}
            value={body}
            maxLength={200000}
            onChange={(event) => setBody(event.target.value)}
          />
        )}
        <div className="dialog-actions">
          {note && (
            <button
              type="button"
              className="button danger"
              disabled={busy}
              onClick={() => void onDelete()}
            >
              {common("delete")}
            </button>
          )}
          <span className="action-spacer" />
          <span className="muted">
            {t("characters", { count: body.length })}
          </span>
          <button
            type="submit"
            className="button primary"
            disabled={busy || !title.trim()}
          >
            {busy ? t("saving") : common("save")}
          </button>
        </div>
      </form>
    </dialog>
  );
}
