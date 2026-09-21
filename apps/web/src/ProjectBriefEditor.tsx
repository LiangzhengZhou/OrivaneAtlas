import type { WorkItem } from "@arclattice/domain";
import type { EditorView } from "@codemirror/view";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { LiveMarkdown } from "./LiveMarkdown";
import { Markdown } from "./Markdown";

export function ProjectBriefEditor({
  dirtyRef,
  project,
  busy,
  onSave,
}: {
  dirtyRef: { current: boolean };
  project: WorkItem;
  busy: boolean;
  onSave(base: WorkItem, markdown: string): Promise<boolean>;
}) {
  const { t } = useTranslation(["desk", "common", "work"]);
  const [draft, setDraft] = useState<{ base: WorkItem; text: string } | null>(
    null,
  );
  const [mode, setMode] = useState<"live" | "source" | "read">("live");
  const [failed, setFailed] = useState(false);
  const [saving, setSaving] = useState(false);
  const inFlight = useRef(false);
  const composing = useRef(false);
  const editorRef = useRef<EditorView | null>(null);
  const conflict = !!draft && draft.base.version !== project.version;
  const dirty = !!draft && draft.text !== draft.base.descriptionMd;
  useEffect(() => {
    dirtyRef.current = dirty;
    return () => {
      dirtyRef.current = false;
    };
  }, [dirty, dirtyRef]);
  useEffect(() => {
    const leave = (event: BeforeUnloadEvent) => {
      if (dirty) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", leave);
    return () => window.removeEventListener("beforeunload", leave);
  }, [dirty]);
  async function save() {
    if (!draft || busy || inFlight.current || composing.current || conflict)
      return;
    inFlight.current = true;
    setSaving(true);
    setFailed(false);
    try {
      if (await onSave(draft.base, draft.text)) setDraft(null);
      else setFailed(true);
    } catch {
      setFailed(true);
    } finally {
      inFlight.current = false;
      setSaving(false);
    }
  }
  function cancel() {
    if (!dirty || window.confirm(t("discardHint"))) {
      setDraft(null);
      setFailed(false);
    }
  }
  return (
    <section className="project-brief-editor">
      {!draft ? (
        <>
          <button
            className="button secondary"
            type="button"
            disabled={busy}
            onClick={() => {
              setDraft({ base: project, text: project.descriptionMd });
              setFailed(false);
            }}
          >
            {t("projectHub.edit")}
          </button>
          <Markdown
            text={project.descriptionMd || t("projectHub.emptyBrief")}
          />
        </>
      ) : (
        <>
          <div className="editor-toolbar">
            {(["live", "source", "read"] as const).map((value) => (
              <button
                type="button"
                key={value}
                className={mode === value ? "chip active" : "chip"}
                aria-pressed={mode === value}
                onClick={() => setMode(value)}
              >
                {t(
                  value === "live"
                    ? "write"
                    : value === "source"
                      ? "markdownSource"
                      : "read",
                )}
              </button>
            ))}
          </div>
          {conflict && (
            <p role="alert" className="error">
              {t("briefVersionConflict")}
            </p>
          )}
          {failed && (
            <p role="alert" className="error">
              {t("briefSaveFailed")}
            </p>
          )}
          {mode === "read" ? (
            <Markdown text={draft.text} />
          ) : mode === "source" ? (
            <textarea
              className="brief-source"
              aria-label={t("work:description")}
              rows={14}
              maxLength={200000}
              value={draft.text}
              onChange={(e) => setDraft({ ...draft, text: e.target.value })}
            />
          ) : (
            <LiveMarkdown
              value={draft.text}
              source={false}
              label={t("work:description")}
              onChange={(text) =>
                setDraft((old) => (old ? { ...old, text } : old))
              }
              onSave={() => void save()}
              onComposition={(active) => {
                composing.current = active;
              }}
              editorRef={editorRef}
            />
          )}
          <div className="dialog-actions">
            <button
              type="button"
              className="button secondary"
              disabled={saving}
              onClick={cancel}
            >
              {t("common:cancel")}
            </button>
            <button
              type="button"
              className="button primary"
              disabled={busy || saving || conflict || !dirty}
              onClick={() => void save()}
            >
              {t("common:save")}
            </button>
          </div>
        </>
      )}
    </section>
  );
}
