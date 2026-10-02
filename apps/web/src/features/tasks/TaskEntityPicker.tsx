import { projectPath, type WorkItem } from "@arclattice/domain";
import { useState } from "react";
import { useTranslation } from "react-i18next";

export function TaskEntityPicker({
  items,
  values,
  excludedId,
  disabled,
  onChange,
}: {
  items: readonly WorkItem[];
  values: readonly string[];
  excludedId?: string | undefined;
  disabled: boolean;
  onChange(values: string[]): void;
}) {
  const { t, i18n } = useTranslation("work");
  const zh = i18n.language.startsWith("zh");
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
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        {zh ? "添加前置任务" : "Add prerequisite"}
      </button>
      {open && (
        <div className="hierarchy-browser">
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
                onClick={() => onChange([...values, item.id])}
              >
                {item.title}{" "}
                <small>
                  {projectPath(item, items)} · {t("statuses." + item.status)}
                </small>
              </button>
            ))}
        </div>
      )}
    </section>
  );
}
