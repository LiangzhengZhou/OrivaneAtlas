import type { WorkItem } from "@arclattice/domain";
import { useMemo } from "react";
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
  label,
  ...props
}: Omit<
  HierarchyPickerProps,
  "entries" | "label" | "rootLabel" | "values" | "onChange"
> & {
  projects: readonly WorkItem[];
  value?: string | null;
  values?: readonly string[];
  label?: string;
  onChange(value: string | string[] | null): void;
}) {
  const { t } = useTranslation("desk");
  const entries = useMemo(() => projectHierarchyEntries(projects), [projects]);
  return (
    <HierarchyPicker
      {...props}
      entries={entries}
      values={props.mode === "single" ? (value ? [value] : []) : values}
      label={label ?? t("projects")}
      rootLabel={t("noProject")}
      onChange={(next) =>
        onChange(props.mode === "single" ? (next[0] ?? null) : next)
      }
    />
  );
}
