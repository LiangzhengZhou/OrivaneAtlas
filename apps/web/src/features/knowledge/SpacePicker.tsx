import type { WorkspaceLibraryEntry as LibraryEntry } from "@arclattice/application";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../../components/ui/Button";

export function SpacePicker({
  spaces,
  value,
  disabled,
  projectSpaceIds = new Set(),
  onChange,
}: {
  spaces: readonly LibraryEntry[];
  value: string | null;
  disabled?: boolean;
  projectSpaceIds?: ReadonlySet<string>;
  onChange(value: string): void;
}) {
  const { i18n } = useTranslation();
  const zh = i18n.language.startsWith("zh");
  const [query, setQuery] = useState("");
  const [recent, setRecent] = useState<string[]>([]);
  const choose = (id: string) => {
    setRecent((previous) =>
      [id, ...previous.filter((value) => value !== id)].slice(0, 5),
    );
    onChange(id);
  };
  const live = spaces.filter(
    (entry) =>
      entry.kind === "SPACE" &&
      !entry.deletedAt &&
      entry.title.toLocaleLowerCase().includes(query.toLocaleLowerCase()),
  );
  return (
    <section className="space-picker">
      <input
        type="search"
        aria-label={zh ? "搜索知识空间" : "Search knowledge spaces"}
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />
      {recent.length > 0 && (
        <div>
          <h4>{zh ? "最近空间" : "Recent spaces"}</h4>
          {live
            .filter((entry) => recent.includes(entry.id))
            .map((entry) => (
              <Button
                type="button"
                variant="toggle"
                key={entry.id}
                disabled={disabled}
                aria-pressed={entry.id === value}
                onClick={() => choose(entry.id)}
              >
                {entry.title}
              </Button>
            ))}
        </div>
      )}
      {[true, false].map((project) => (
        <div key={String(project)}>
          {projectSpaceIds.size > 0 && (
            <h4>
              {project
                ? zh
                  ? "项目空间"
                  : "Project spaces"
                : zh
                  ? "其他空间"
                  : "Other spaces"}
            </h4>
          )}
          {live
            .filter(
              (entry) =>
                projectSpaceIds.has(entry.id) === project &&
                !recent.includes(entry.id),
            )
            .map((entry) => (
              <Button
                type="button"
                variant="toggle"
                key={entry.id}
                disabled={disabled ?? false}
                aria-pressed={entry.id === value}
                onClick={() => choose(entry.id)}
              >
                {entry.title}
              </Button>
            ))}
        </div>
      ))}
    </section>
  );
}
