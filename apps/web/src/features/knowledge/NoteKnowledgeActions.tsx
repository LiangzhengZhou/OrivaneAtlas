import type { LibraryEntry, Note } from "@arclattice/application";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { Runtime, Snapshot } from "../../bootstrap";
import { Button } from "../../components/ui/Button";
import { Select } from "../../components/ui/Surfaces";
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
  const [folderLinkChoice, setFolderLinkChoice] = useState("");
  const [folderLinkName, setFolderLinkName] = useState("");
  const linked = snapshot.links.filter(
    (link) =>
      !link.deletedAt &&
      link.from.kind === "NOTE" &&
      link.from.id === note.id &&
      link.to.kind === "SPACE",
  );
  const folderNames = new Map(
    snapshot.organization
      .filter((entry) => entry.kind === "FOLDER")
      .map((entry) => [entry.id, entry.name ?? ""]),
  );
  const linkedFolders = (snapshot.folderLinks ?? [])
    .filter(
      (link) =>
        !link.deletedAt &&
        link.targetKind === "NOTE" &&
        link.targetId === note.id,
    )
    .map((link) => ({
      id: link.id,
      version: link.version,
      name: folderNames.get(link.folderId) || link.folderId,
    }));
  const generalFolders = snapshot.organization.filter(
    (entry) => entry.kind === "FOLDER" && entry.scope === "GENERAL",
  );
  async function changeFolderLink(action: () => Promise<unknown>) {
    setPending(true);
    try {
      await action();
      onChanged();
    } catch {
      setError("UNAVAILABLE");
    } finally {
      setPending(false);
    }
  }
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
      <div className="project-linked-folder-list">
        {linkedFolders.map((folder) => (
          <span key={folder.id} className="project-linked-folder">
            {folder.name}
            <Button
              type="button"
              variant="ghost"
              disabled={pending}
              aria-label={`${zh ? "解除关联" : "Unlink"}: ${folder.name}`}
              onClick={() =>
                void changeFolderLink(() =>
                  runtime.unlinkFolder(folder.id, folder.version),
                )
              }
            >
              ×
            </Button>
          </span>
        ))}
      </div>
      <div className="project-link-folder-actions">
        <Select
          aria-label={zh ? "选择资料夹" : "Choose folder"}
          value={folderLinkChoice}
          onChange={(event) => setFolderLinkChoice(event.currentTarget.value)}
        >
          <option value="">{zh ? "选择资料夹" : "Choose folder"}</option>
          {generalFolders.map((folder) => (
            <option key={folder.id} value={folder.id}>
              {folder.name}
            </option>
          ))}
        </Select>
        <Button
          type="button"
          variant="secondary"
          disabled={!folderLinkChoice || pending}
          onClick={() =>
            void changeFolderLink(() =>
              runtime.linkFolder({
                folderId: folderLinkChoice,
                targetKind: "NOTE",
                targetId: note.id,
              }),
            )
          }
        >
          {zh ? "关联资料夹" : "Link folder"}
        </Button>
        <input
          aria-label={zh ? "新资料夹名称" : "New folder name"}
          placeholder={zh ? "新资料夹名称" : "New folder name"}
          value={folderLinkName}
          onChange={(event) => setFolderLinkName(event.target.value)}
        />
        <Button
          type="button"
          variant="secondary"
          disabled={!folderLinkName.trim() || pending}
          onClick={() =>
            void changeFolderLink(async () => {
              const id = crypto.randomUUID();
              await runtime.organize({
                kind: "FOLDER",
                action: "create",
                id,
                name: folderLinkName.trim(),
                parentId: "",
                scope: "GENERAL",
              });
              await runtime.linkFolder({
                folderId: id,
                targetKind: "NOTE",
                targetId: note.id,
              });
              setFolderLinkName("");
            })
          }
        >
          {zh ? "新建并关联" : "Create and link"}
        </Button>
      </div>
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
