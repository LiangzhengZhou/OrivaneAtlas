import type { WorkspaceLibraryEntry as LibraryEntry } from "@arclattice/application";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { HierarchyPicker } from "../hierarchy/HierarchyPicker";

export function SpacePicker({
  spaces,
  value,
  disabled,
  projectSpaceIds,
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
  const entries = useMemo(
    () =>
      spaces
        .filter((entry) => entry.kind === "SPACE" && !entry.deletedAt)
        .sort(
          (a, b) =>
            Number(projectSpaceIds?.has(b.id) ?? false) -
            Number(projectSpaceIds?.has(a.id) ?? false),
        )
        .map((entry) => ({ id: entry.id, title: entry.title, parentId: null })),
    [spaces, projectSpaceIds],
  );
  return (
    <section className="space-picker">
      <HierarchyPicker
        kind="SPACE"
        entries={entries}
        mode="single"
        values={value ? [value] : []}
        disabled={disabled ?? false}
        allowClear={false}
        label={zh ? "选择知识空间" : "Choose knowledge space"}
        rootLabel={zh ? "知识空间" : "Knowledge spaces"}
        onChange={(values) => {
          const id = values[0];
          if (id) onChange(id);
        }}
      />
    </section>
  );
}
