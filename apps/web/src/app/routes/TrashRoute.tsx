import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { Runtime, Snapshot } from "../../bootstrap";
import { Button } from "../../components/ui/Button";
import { confirmAction } from "../../components/ui/ConfirmationHost";
import { Select } from "../../components/ui/Surfaces";

import type { VersionedResource } from "../../features/files/versioned-resource";

export function TrashRoute({
  snapshot,
  runtime,
  query,
  busy,
  run,
  onRestoreSelection,
  batchPending,
}: {
  snapshot: Snapshot;
  runtime: Runtime;
  query: string;
  busy: boolean;
  run(action: () => Promise<unknown>): Promise<boolean>;
  onRestoreSelection(items: readonly VersionedResource[]): Promise<boolean>;
  batchPending: boolean;
}) {
  const { t, i18n } = useTranslation("desk");
  const zh = i18n.language.startsWith("zh");
  const initialFilter = () => {
    const value = new URLSearchParams(location.hash.split("?")[1]).get(
      "filter",
    );
    return ["library", "work", "note", "folders"].includes(value ?? "")
      ? value!
      : "all";
  };
  const [filter, setFilter] = useState(initialFilter);
  const [selection, setSelection] = useState<Set<string> | null>(null);
  const filterKey = JSON.stringify([filter, query]);
  const [previous, setPrevious] = useState(filterKey);
  if (previous !== filterKey) {
    setPrevious(filterKey);
    setSelection(null);
  }
  useEffect(() => {
    const changed = () => setFilter(initialFilter());
    window.addEventListener("hashchange", changed);
    return () => window.removeEventListener("hashchange", changed);
  }, []);
  const entries = [
    ...snapshot.items
      .filter((entry) => entry.deletedAt)
      .map((entry) => ({ ...entry, kind: "WORK" as const })),
    ...snapshot.notes
      .filter((entry) => entry.deletedAt)
      .map((entry) => ({ ...entry, kind: "NOTE" as const })),
    ...snapshot.library.filter((entry) => entry.deletedAt),
    ...(snapshot.files ?? [])
      .filter((entry) => entry.deletedAt)
      .map((entry) => ({
        ...entry,
        kind: "FILE" as const,
        title: entry.name,
        bodyMd: "",
      })),
    ...snapshot.organization
      .filter((entry) => entry.kind === "FOLDER" && entry.archived)
      .map((entry) => ({
        ...entry,
        kind: "FOLDER" as const,
        title: entry.name ?? "",
        bodyMd: "",
      })),
  ]
    .filter(
      (entry) =>
        filter === "all" ||
        (filter === "work"
          ? entry.kind === "WORK"
          : filter === "note"
            ? entry.kind === "NOTE"
            : filter === "folders"
              ? entry.kind === "FOLDER"
              : entry.kind === "SPACE" ||
                entry.kind === "DOCUMENT" ||
                entry.kind === "FILE"),
    )
    .filter((entry) =>
      (
        entry.title +
        " " +
        (entry.kind === "WORK" ? entry.descriptionMd : (entry.bodyMd ?? ""))
      )
        .toLocaleLowerCase()
        .includes(query.toLocaleLowerCase()),
    );
  const selectable = entries.flatMap((entry): VersionedResource[] =>
    entry.kind === "NOTE" || entry.kind === "DOCUMENT" || entry.kind === "FILE"
      ? [
          {
            id: entry.id,
            version: entry.version,
            kind: entry.kind,
            parentDocumentId:
              "parentDocumentId" in entry ? entry.parentDocumentId : null,
          },
        ]
      : [],
  );
  const checked = selectable.filter((entry) =>
    selection?.has(entry.kind + ":" + entry.id),
  );
  return (
    <div className="trash-list">
      <label>
        {zh ? "类型" : "Type"}
        <Select
          aria-label={zh ? "类型" : "Type"}
          value={filter}
          onChange={(event) => {
            location.hash = `#trash?filter=${event.target.value}`;
          }}
        >
          <option value="all">{t("common:all")}</option>
          <option value="work">
            {zh ? "任务与项目" : "Tasks and projects"}
          </option>
          <option value="note">{t("notes")}</option>
          <option value="folders">{zh ? "文件夹" : "Folders"}</option>
          <option value="library">{zh ? "知识库" : "Library"}</option>
        </Select>
      </label>
      {selectable.length > 0 && (
        <section
          className="files-selection-toolbar"
          aria-label={zh ? "批量恢复资源" : "Restore resources in bulk"}
        >
          <Button
            variant="ghost"
            aria-pressed={selection !== null}
            disabled={batchPending}
            onClick={() => setSelection(selection === null ? new Set() : null)}
          >
            {selection === null
              ? zh
                ? "选择要恢复的资源"
                : "Select resources to restore"
              : zh
                ? "取消多选"
                : "Cancel selection"}
          </Button>
          {selection !== null && (
            <>
              <label>
                <input
                  type="checkbox"
                  checked={checked.length === selectable.length}
                  disabled={batchPending}
                  onChange={(e) =>
                    setSelection(
                      new Set(
                        e.target.checked
                          ? selectable.map((item) => item.kind + ":" + item.id)
                          : [],
                      ),
                    )
                  }
                />
                {zh ? "选择筛选结果中的资源" : "Select filtered resources"}
              </label>
              <Button
                disabled={!checked.length}
                pending={batchPending}
                onClick={async () => {
                  if (await onRestoreSelection(checked)) setSelection(null);
                }}
              >
                {zh
                  ? `恢复所选项（${checked.length}）`
                  : `Restore selected (${checked.length})`}
              </Button>
            </>
          )}
        </section>
      )}
      {entries.map((entry) => (
        <div key={`${entry.kind}:${entry.id}`}>
          {selection !== null &&
            (entry.kind === "NOTE" ||
              entry.kind === "FILE" ||
              entry.kind === "DOCUMENT") && (
              <input
                type="checkbox"
                aria-label={entry.title}
                disabled={batchPending}
                checked={selection.has(entry.kind + ":" + entry.id)}
                onChange={(event) => {
                  const key = entry.kind + ":" + entry.id;
                  const next = new Set(selection);
                  if (event.target.checked) next.add(key);
                  else next.delete(key);
                  setSelection(next);
                }}
              />
            )}
          <span>{entry.title}</span>
          <Button
            type="button"
            variant="secondary"
            disabled={busy}
            onClick={() =>
              void run(() =>
                entry.kind === "WORK"
                  ? runtime.service.setDeleted(
                      runtime.context!,
                      entry.id,
                      entry.version,
                      false,
                    )
                  : entry.kind === "NOTE"
                    ? runtime.deleteNote(entry.id, entry.version, false)
                    : entry.kind === "FILE"
                      ? runtime.deleteFile(entry.id, entry.version, false)
                      : entry.kind === "FOLDER"
                        ? runtime.organize({
                            kind: "FOLDER",
                            action: "unarchive",
                            entries: snapshot.organization
                              .filter(
                                (folder) =>
                                  folder.kind === "FOLDER" &&
                                  folder.archived &&
                                  (entry.trashBatchId
                                    ? folder.trashBatchId === entry.trashBatchId
                                    : folder.id === entry.id),
                              )
                              .map((folder) => ({
                                id: folder.id,
                                version: folder.version,
                                organizationVersion: folder.version,
                              })),
                          })
                        : runtime.deleteLibrary(entry.id, entry.version, false),
              )
            }
          >
            {t("common:restore")}
          </Button>
          {entry.kind !== "FILE" && entry.kind !== "FOLDER" && (
            <Button
              type="button"
              variant="danger"
              disabled={busy}
              onClick={async () => {
                if (
                  await confirmAction(
                    t("permanentDeleteConfirm", { title: entry.title }),
                  )
                )
                  void run(() =>
                    entry.kind === "WORK"
                      ? runtime.service.purge(
                          runtime.context!,
                          entry.id,
                          entry.version,
                        )
                      : entry.kind === "NOTE"
                        ? runtime.purgeNote(entry.id, entry.version)
                        : runtime.purgeLibrary(entry.id, entry.version),
                  );
              }}
            >
              {t("permanentDelete")}
            </Button>
          )}
        </div>
      ))}
      {entries.length === 0 && (
        <p className="empty-small">{t("work:emptyTrash")}</p>
      )}
    </div>
  );
}
