import type { LibraryEntry } from "@arclattice/application";
import { useTranslation } from "react-i18next";
import { HierarchyPicker } from "../hierarchy/HierarchyPicker";
import { excludedBranch } from "../hierarchy/hierarchy";

export function DocumentDrilldownPicker({
  documents,
  spaceId,
  documentId,
  value,
  disabled,
  onChange,
}: {
  documents: readonly LibraryEntry[];
  spaceId: string;
  documentId?: string;
  value?: string | null;
  disabled?: boolean;
  onChange(value: string | null): void;
}) {
  const { i18n } = useTranslation();
  const zh = i18n.language.startsWith("zh");
  const entries = documents
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
    }));
  return (
    <HierarchyPicker
      entries={entries}
      mode="single"
      values={value ? [value] : []}
      excludedIds={documentId ? excludedBranch(entries, documentId) : new Set()}
      disabled={disabled ?? false}
      label={zh ? "父文档" : "Parent document"}
      rootLabel={zh ? "顶层" : "Top level"}
      onChange={(values) => onChange(values[0] ?? null)}
    />
  );
}
