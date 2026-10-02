import type { WorkItem } from "@arclattice/domain";
import { useTranslation } from "react-i18next";
import {
  HierarchyPicker,
  type HierarchyPickerProps,
} from "../hierarchy/HierarchyPicker";
import { projectHierarchyEntries } from "./project-hierarchy";

export function ProjectDrilldownPicker({
  projects,
  value,
  values = [],
  onChange,
  ...props
}: Omit<
  HierarchyPickerProps,
  "entries" | "label" | "rootLabel" | "values" | "onChange"
> & {
  projects: readonly WorkItem[];
  value?: string | null;
  values?: readonly string[];
  onChange(value: string | string[] | null): void;
}) {
  const { t } = useTranslation("desk");
  return (
    <HierarchyPicker
      {...props}
      entries={projectHierarchyEntries(projects)}
      values={props.mode === "single" ? (value ? [value] : []) : values}
      label={t("projects")}
      rootLabel={t("noProject")}
      onChange={(next) =>
        onChange(props.mode === "single" ? (next[0] ?? null) : next)
      }
    />
  );
}
