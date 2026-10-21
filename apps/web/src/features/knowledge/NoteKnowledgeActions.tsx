import type { LibraryEntry, Note } from "@arclattice/application";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { Runtime, Snapshot } from "../../bootstrap";
import { Button } from "../../components/ui/Button";
import { DocumentDrilldownPicker } from "../documents/DocumentDrilldownPicker";
import { noteWikiReferences } from "./note-wiki-references";
import { SpacePicker } from "./SpacePicker";

export function NoteKnowledgeActions({
  note,
  snapshot,
  runtime,
  disabled,
  onChanged,
  onPromoted,
  onOpenWiki,
}: {
  note: Note;
  snapshot: Snapshot;
  runtime: Runtime;
  disabled: boolean;
  onChanged(): void;
  onPromoted(document: LibraryEntry): void;
  onOpenWiki(id: string): void;
}) {
  const { i18n } = useTranslation();
  const zh = i18n.language.startsWith("zh");
  const [action, setAction] = useState<"promote" | "link" | null>(null);
  const [spaceId, setSpaceId] = useState("");
  const [parentId, setParentId] = useState<string | null>(null);
  const [archive, setArchive] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const linked = snapshot.links.filter(
    (link) =>
      !link.deletedAt &&
      link.from.kind === "NOTE" &&
      link.from.id === note.id &&
      link.to.kind === "SPACE",
  );
  return (
    <section
      className="note-knowledge-actions no-print"
      aria-label={zh ? "整理为知识" : "Organize knowledge"}
    >
      <Button
        type="button"
        variant="toggle"
        disabled={disabled || pending}
        onClick={() => setAction("promote")}
      >
        {zh ? "创建知识文档" : "Create knowledge document"}
      </Button>
      <Button
        type="button"
        variant="toggle"
        disabled={disabled || pending}
        onClick={() => setAction("link")}
      >
        {zh ? "关联到知识空间" : "Link to knowledge space"}
      </Button>
      {linked.map((link) => (
        <p key={link.id}>
          {zh ? "已链接到" : "Linked to"}:{" "}
          {snapshot.library.find((entry) => entry.id === link.to.id)?.title}
        </p>
      ))}
      {noteWikiReferences([note], snapshot.library).length > 0 && (
        <div className="capture-wiki-references">
          <h4>{zh ? "Wiki 引用" : "Wiki references"}</h4>
          {noteWikiReferences([note], snapshot.library).map((link, index) => (
            <span key={String(index)}>
              {link.targetDocumentId ? (
                <Button
                  variant="ghost"
                  type="button"
                  onClick={() => onOpenWiki(link.targetDocumentId!)}
                >
                  {link.alias ?? link.targetText}
                </Button>
              ) : (
                <span className="muted">
                  {link.alias ?? link.targetText} ·{" "}
                  {zh ? "未解析" : "Unresolved"}
                </span>
              )}
            </span>
          ))}
        </div>
      )}
      {action && (
        <div className="panel">
          <p>
            {action === "promote"
              ? zh
                ? "创建独立知识文档，保留来源笔记及其正文。"
                : "Create an independent knowledge document, preserving the source note and its body."
              : zh
                ? "仅创建关联，笔记位置和正文不变。"
                : "Create a relationship; the note's location and body stay unchanged."}
          </p>
          <SpacePicker
            spaces={snapshot.library}
            value={spaceId || null}
            disabled={pending}
            projectSpaceIds={
              new Set(
                snapshot.projectMaterials
                  .filter(
                    (binding) =>
                      binding.kind === "SPACE" &&
                      !binding.deletedAt &&
                      binding.targetId,
                  )
                  .map((binding) => binding.targetId!),
              )
            }
            onChange={(value) => {
              setSpaceId(value);
              setParentId(null);
            }}
          />
          {action === "promote" && spaceId && (
            <>
              <DocumentDrilldownPicker
                documents={snapshot.library}
                spaceId={spaceId}
                value={parentId}
                disabled={pending}
                onChange={setParentId}
              />
              <label>
                <input
                  type="checkbox"
                  checked={archive}
                  disabled={pending}
                  onChange={(event) => setArchive(event.target.checked)}
                />
                {zh ? "将来源笔记移至回收站" : "Move source note to Trash"}
              </label>
            </>
          )}
          <Button
            variant="primary"
            type="button"
            disabled={!spaceId || pending}
            onClick={async () => {
              setPending(true);
              setError("");
              try {
                if (action === "promote")
                  onPromoted(
                    await runtime.promoteNote(
                      note.id,
                      note.version,
                      spaceId,
                      archive,
                      parentId,
                    ),
                  );
                else
                  await runtime.linkNoteToSpace(note.id, note.version, spaceId);
                onChanged();
                setAction(null);
              } catch (failure) {
                setError(
                  failure instanceof Error ? failure.message : "UNAVAILABLE",
                );
              } finally {
                setPending(false);
              }
            }}
          >
            {action === "promote"
              ? zh
                ? "创建页面"
                : "Create page"
              : zh
                ? "链接"
                : "Link"}
          </Button>
          <Button
            variant="ghost"
            type="button"
            disabled={pending}
            onClick={() => setAction(null)}
          >
            {zh ? "取消" : "Cancel"}
          </Button>
        </div>
      )}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
