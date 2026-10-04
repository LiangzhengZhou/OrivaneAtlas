import type { WorkItem } from "@arclattice/domain";
import type { EditorView } from "@codemirror/view";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "./components/ui/Button";
import { confirmAction } from "./components/ui/ConfirmationHost";
import { LiveMarkdown } from "./LiveMarkdown";
import { Markdown } from "./Markdown";

export interface ProjectBriefState {
  draft: { base: WorkItem; text: string } | null;
  mode: "live" | "source" | "read";
}

export function ProjectBriefEditor({
  dirtyRef,
  project,
  busy,
  onSave,
  retained,
}: {
  dirtyRef: { current: boolean };
  project: WorkItem;
  busy: boolean;
  onSave(base: WorkItem, markdown: string): Promise<boolean>;
  retained?: { current: ProjectBriefState };
}) {
  const { t } = useTranslation(["desk", "common", "work"]);
  const [draft, setDraft] = useState<{ base: WorkItem; text: string } | null>(
    retained?.current.draft?.base.id === project.id
      ? retained.current.draft
      : null,
  );
  const [mode, setMode] = useState<"live" | "source" | "read">(
    retained?.current.mode ?? "live",
  );
  if (retained) retained.current = { draft, mode };
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
      dirtyRef.current = retained
        ? !!retained.current.draft &&
          retained.current.draft.text !==
            retained.current.draft.base.descriptionMd
        : false;
    };
  }, [dirty, dirtyRef, retained]);
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
      const text =
        mode === "live" && editorRef.current
          ? editorRef.current.state.doc.toString()
          : draft.text;
      if (await onSave(draft.base, text)) setDraft(null);
      else setFailed(true);
    } catch {
      setFailed(true);
    } finally {
      inFlight.current = false;
      setSaving(false);
    }
  }
  async function cancel() {
    if (!dirty || (await confirmAction(t("discardHint")))) {
      setDraft(null);
      setFailed(false);
    }
  }
  return (
    <section className="project-brief-editor">
      {!draft ? (
        <>
          <Button
            className="button secondary"
            type="button"
            disabled={busy}
            onClick={() => {
              setDraft({ base: project, text: project.descriptionMd });
              setFailed(false);
            }}
          >
            {t("projectHub.edit")}
          </Button>
          <Markdown
            text={project.descriptionMd || t("projectHub.emptyBrief")}
          />
        </>
      ) : (
        <>
          <div className="editor-toolbar">
            {(["live", "source", "read"] as const).map((value) => (
              <Button
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
              </Button>
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
              onChange={(text) => {
                if (retained?.current.draft)
                  retained.current.draft = { ...retained.current.draft, text };
                setDraft((old) => (old ? { ...old, text } : old));
              }}
              onSave={() => void save()}
              onComposition={(active) => {
                composing.current = active;
              }}
              editorRef={editorRef}
            />
          )}
          <div className="dialog-actions">
            <Button
              type="button"
              className="button secondary"
              disabled={saving}
              onClick={cancel}
            >
              {t("common:cancel")}
            </Button>
            <Button
              variant="primary"
              type="button"
              className="button primary"
              disabled={busy || saving || conflict || !dirty}
              onClick={() => void save()}
            >
              {t("common:save")}
            </Button>
          </div>
        </>
      )}
    </section>
  );
}
