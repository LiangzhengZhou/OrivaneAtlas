import { projectPath, type WorkItem } from "@arclattice/domain";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { AnchoredFloatingSurface } from "../../app/AnchoredFloatingSurface";

export function TaskEntityPicker({
  items,
  label,
  mode = "multiple",
  values,
  excludedId,
  disabled,
  onChange,
}: {
  label?: string;
  mode?: "single" | "multiple";
  items: readonly WorkItem[];
  values: readonly string[];
  excludedId?: string | undefined;
  disabled: boolean;
  onChange(values: string[]): void;
}) {
  const { t, i18n } = useTranslation("work");
  const zh = i18n.language.startsWith("zh");
  const anchorRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  return (
    <section>
      <div className="hierarchy-selected">
        {values.map((id) => (
          <button
            type="button"
            className="chip"
            key={id}
            disabled={disabled}
            onClick={() => onChange(values.filter((value) => value !== id))}
          >
            {items.find((item) => item.id === id)?.title ?? id} ×
          </button>
        ))}
      </div>
      <button
        type="button"
        className="chip"
        disabled={disabled}
        ref={anchorRef}
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        {label ?? (zh ? "添加前置任务" : "Add prerequisite")}
      </button>
      {open && (
        <AnchoredFloatingSurface
          anchorRef={anchorRef}
          onDismiss={() => setOpen(false)}
          label={label ?? t("prerequisites")}
          placement="bottom-start"
          className="hierarchy-browser"
        >
          <input
            type="search"
            aria-label={t("prerequisites")}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          {items
            .filter(
              (item) =>
                item.type === "TASK" &&
                !item.deletedAt &&
                item.id !== excludedId &&
                !values.includes(item.id) &&
                item.title
                  .toLocaleLowerCase()
                  .includes(query.toLocaleLowerCase()),
            )
            .map((item) => (
              <button
                type="button"
                className="text-button"
                key={item.id}
                disabled={disabled}
                onClick={() => {
                  onChange(
                    mode === "single" ? [item.id] : [...values, item.id],
                  );
                  if (mode === "single") setOpen(false);
                }}
              >
                {item.title}{" "}
                <small>
                  {projectPath(item, items)} · {t("statuses." + item.status)}
                </small>
              </button>
            ))}
        </AnchoredFloatingSurface>
      )}
    </section>
  );
}
