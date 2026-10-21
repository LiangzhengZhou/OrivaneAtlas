import type { WorkspaceLibraryEntry as LibraryEntry } from "@arclattice/application";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { HierarchyPicker } from "../hierarchy/HierarchyPicker";
import { excludedBranch } from "../hierarchy/hierarchy";

export function DocumentDrilldownPicker({
  documents,
  spaceId,
  documentId,
  value,
  disabled,
  label,
  onChange,
}: {
  documents: readonly LibraryEntry[];
  spaceId: string;
  documentId?: string;
  value?: string | null;
  disabled?: boolean;
  label?: string;
  onChange(value: string | null): void;
}) {
  const { i18n } = useTranslation();
  const zh = i18n.language.startsWith("zh");
  const entries = useMemo(
    () =>
      documents
        .filter(
          (entry) =>
            entry.kind === "DOCUMENT" &&
            entry.spaceId === spaceId &&
            !entry.deletedAt,
        )
        .map((entry) => ({
          id: entry.id,
          title: entry.title,
          parentId: entry.parentDocumentId ?? null,
        })),
    [documents, spaceId],
  );
  const accessibleIds = useMemo(
    () =>
      new Set(
        documents
          .filter((entry) => entry.kind === "DOCUMENT" && !entry.deletedAt)
          .map((entry) => entry.id),
      ),
    [documents],
  );
  const excludedIds = useMemo(
    () =>
      documentId ? excludedBranch(entries, documentId) : new Set<string>(),
    [entries, documentId],
  );
  return (
    <HierarchyPicker
      kind="DOCUMENT"
      accessibleIds={accessibleIds}
      entries={entries}
      mode="single"
      values={value ? [value] : []}
      excludedIds={excludedIds}
      disabled={disabled ?? false}
      label={label ?? (zh ? "父文档" : "Parent document")}
      rootLabel={zh ? "顶层" : "Top level"}
      onChange={(values) => onChange(values[0] ?? null)}
    />
  );
}
