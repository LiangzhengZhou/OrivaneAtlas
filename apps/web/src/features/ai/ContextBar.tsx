import type { AiContextItem } from "@arclattice/application";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { AnchoredFloatingSurface } from "../../app/AnchoredFloatingSurface";
import type { Snapshot } from "../../bootstrap";
import { Button } from "../../components/ui/Button";
import { DocumentDrilldownPicker } from "../documents/DocumentDrilldownPicker";
import { SpacePicker } from "../knowledge/SpacePicker";
import { ProjectDrilldownPicker } from "../projects/ProjectDrilldownPicker";

export function ContextBar({
  snapshot,
  projectId,
  spaceId,
  context,
  disabled,
  onProject,
  onSpace,
  onContext,
}: {
  snapshot: Snapshot;
  projectId: string | null;
  spaceId: string | null;
  context: readonly AiContextItem[];
  disabled: boolean;
  onProject(id: string | null): void;
  onSpace(id: string | null): void;
  onContext(items: AiContextItem[]): void;
}) {
  const { i18n } = useTranslation();
  const zh = i18n.language.startsWith("zh");
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLButtonElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  return (
    <div
      ref={containerRef}
      className="context-bar"
      aria-label={zh ? "对话上下文" : "Conversation context"}
    >
      {projectId && (
        <Button
          type="button"
          className="chip"
          disabled={disabled}
          onClick={() => onProject(null)}
        >
          {snapshot.items.find((entry) => entry.id === projectId)?.title} ×
        </Button>
      )}
      {spaceId && (
        <Button
          type="button"
          className="chip"
          disabled={disabled}
          onClick={() => onSpace(null)}
        >
          {snapshot.library.find((entry) => entry.id === spaceId)?.title} ×
        </Button>
      )}
      {context.map((entry) => (
        <Button
          type="button"
          className="chip"
          key={entry.ref.id}
          disabled={disabled}
          onClick={() =>
            onContext(context.filter((item) => item.ref.id !== entry.ref.id))
          }
        >
          {entry.title} ×
        </Button>
      ))}
      <Button
        ref={anchorRef}
        type="button"
        className="chip"
        disabled={disabled}
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        {zh ? "添加上下文" : "Add context"}
      </Button>
      {open && (
        <AnchoredFloatingSurface
          anchorRef={anchorRef}
          dismissBoundaryRef={containerRef}
          portalTarget={containerRef.current ?? undefined}
          onDismiss={() => setOpen(false)}
          label={zh ? "对话上下文选择" : "Choose conversation context"}
          className="context-picker panel"
        >
          <ProjectDrilldownPicker
            projects={snapshot.items}
            mode="single"
            value={projectId}
            onChange={(value) =>
              onProject(typeof value === "string" ? value : null)
            }
          />
          <SpacePicker
            spaces={snapshot.library}
            value={spaceId}
            projectSpaceIds={
              new Set(
                snapshot.projectMaterials
                  .filter(
                    (entry) =>
                      entry.projectId === projectId &&
                      !entry.deletedAt &&
                      entry.kind === "SPACE" &&
                      entry.targetId,
                  )
                  .map((entry) => entry.targetId!),
              )
            }
            onChange={onSpace}
          />
          {spaceId && (
            <DocumentDrilldownPicker
              documents={snapshot.library}
              spaceId={spaceId}
              onChange={(id) => {
                const entry = snapshot.library.find((entry) => entry.id === id);
                if (!entry || context.some((item) => item.ref.id === id))
                  return;
                onContext([
                  ...context,
                  {
                    ref: { kind: "DOCUMENT", id: entry.id },
                    version: entry.version,
                    title: entry.title,
                    source: "selected",
                    tokenEstimate: Math.ceil(entry.bodyMd.length / 4),
                    permission: entry.aiPolicy ?? {
                      classification: "PRIVATE",
                      processingBoundary: "LOCAL_ONLY",
                      aiAccess: "DENY",
                    },
                  },
                ]);
              }}
            />
          )}
        </AnchoredFloatingSurface>
      )}
    </div>
  );
}
