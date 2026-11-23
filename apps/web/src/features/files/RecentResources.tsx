import type {
  EntityRef,
  WorkspaceLibraryEntry,
  WorkspaceNote,
} from "@arclattice/application";
import type { LibraryFile } from "@arclattice/domain";
import { ArrowUpRight, BookOpen, File, FileText } from "lucide-react";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../../components/ui/Button";
import { useResourceShortcuts } from "./useResourceShortcuts";

export function RecentResources({
  scopeKey,
  workspaceId,
  notes,
  library,
  files,
  onOpen,
  onBrowse,
}: {
  scopeKey: string;
  workspaceId: string;
  notes: readonly WorkspaceNote[];
  library: readonly WorkspaceLibraryEntry[];
  files: readonly LibraryFile[] | undefined;
  onOpen(ref: EntityRef): void;
  onBrowse(): void;
}) {
  const { i18n } = useTranslation("desk");
  const zh = i18n.language.startsWith("zh");
  const shortcuts = useResourceShortcuts(scopeKey);
  const entries = useMemo(() => {
    const wanted = new Set(shortcuts.recent);
    const matches = new Map<string, { ref: EntityRef; title: string }>();
    if (wanted.size) {
      const add = (
        entity: { id: string; workspaceId: string; deletedAt: string | null },
        kind: "FILE" | "DOCUMENT" | "NOTE",
        title: string,
      ) => {
        const key = kind + ":" + entity.id;
        if (
          wanted.has(key) &&
          !entity.deletedAt &&
          entity.workspaceId === workspaceId
        )
          matches.set(key, { ref: { kind, id: entity.id }, title });
      };
      for (const note of notes)
        if (note.kind === "NOTE") add(note, "NOTE", note.title);
      for (const doc of library)
        if (doc.kind === "DOCUMENT") add(doc, "DOCUMENT", doc.title);
      for (const file of files ?? []) add(file, "FILE", file.name);
    }
    return shortcuts.recent
      .flatMap((key) => {
        const entry = matches.get(key);
        return entry ? [{ ...entry, key }] : [];
      })
      .slice(0, 3);
  }, [shortcuts.recent, workspaceId, notes, library, files]);
  const title = zh ? "最近打开的资源" : "Recently opened resources";
  return (
    <section className="overview-recent-resources" aria-label={title}>
      <div className="panel-heading">
        <h2>{title}</h2>
        <Button variant="ghost" onClick={onBrowse}>
          {zh ? "浏览资源" : "Browse resources"}
          <ArrowUpRight size={15} />
        </Button>
      </div>
      {entries.length ? (
        <ul>
          {entries.map(({ ref, key, title }) => {
            const Icon =
              ref.kind === "FILE"
                ? File
                : ref.kind === "NOTE"
                  ? BookOpen
                  : FileText;
            const kind =
              ref.kind === "FILE"
                ? zh
                  ? "文件"
                  : "File"
                : ref.kind === "NOTE"
                  ? zh
                    ? "笔记"
                    : "Note"
                  : zh
                    ? "文档"
                    : "Document";
            return (
              <li key={key}>
                <Button
                  variant="ghost"
                  onClick={() => {
                    shortcuts.markOpened(key);
                    onOpen(ref);
                  }}
                >
                  <Icon size={16} aria-hidden="true" />
                  <span>{title || (zh ? "未命名" : "Untitled")}</span>
                  <small>{kind}</small>
                </Button>
              </li>
            );
          })}
        </ul>
      ) : (
        <p>
          {zh
            ? "在资源中心打开文件、笔记或文档，就能从这里继续阅读。"
            : "Open a file, note or document in the resource center to resume it here."}
        </p>
      )}
    </section>
  );
}
