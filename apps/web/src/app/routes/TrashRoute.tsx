import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { Runtime, Snapshot } from "../../bootstrap";

export function TrashRoute({
  snapshot,
  runtime,
  query,
  busy,
  run,
}: {
  snapshot: Snapshot;
  runtime: Runtime;
  query: string;
  busy: boolean;
  run(action: () => Promise<unknown>): Promise<boolean>;
}) {
  const { t, i18n } = useTranslation("desk");
  const zh = i18n.language.startsWith("zh");
  const initialFilter = () => {
    const value = new URLSearchParams(location.hash.split("?")[1]).get(
      "filter",
    );
    return ["library", "work", "note"].includes(value ?? "") ? value! : "all";
  };
  const [filter, setFilter] = useState(initialFilter);
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
  ]
    .filter(
      (entry) =>
        filter === "all" ||
        (filter === "work"
          ? entry.kind === "WORK"
          : filter === "note"
            ? entry.kind === "NOTE"
            : entry.kind === "SPACE" || entry.kind === "DOCUMENT"),
    )
    .filter((entry) =>
      (
        entry.title +
        " " +
        ("bodyMd" in entry ? entry.bodyMd : entry.descriptionMd)
      )
        .toLocaleLowerCase()
        .includes(query.toLocaleLowerCase()),
    );
  return (
    <div className="trash-list">
      <label>
        {zh ? "类型" : "Type"}
        <select
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
          <option value="library">{zh ? "知识库" : "Library"}</option>
        </select>
      </label>
      {entries.map((entry) => (
        <div key={`${entry.kind}:${entry.id}`}>
          <span>{entry.title}</span>
          <button
            type="button"
            className="button secondary"
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
                    : runtime.deleteLibrary(entry.id, entry.version, false),
              )
            }
          >
            {t("common:restore")}
          </button>
          <button
            type="button"
            className="button danger"
            disabled={busy}
            onClick={() => {
              if (
                window.confirm(
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
          </button>
        </div>
      ))}
      {entries.length === 0 && (
        <p className="empty-small">{t("work:emptyTrash")}</p>
      )}
    </div>
  );
}
