import { useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { currentLevel, type HierarchyEntry, hierarchyPath } from "./hierarchy";

export type HierarchyPickerProps = {
  entries: readonly HierarchyEntry[];
  mode: "single" | "multiple";
  values: readonly string[];
  excludedIds?: ReadonlySet<string>;
  disabledIds?: ReadonlySet<string>;
  disabled?: boolean;
  initialParentId?: string | null;
  label: string;
  rootLabel: string;
  onChange(values: string[]): void;
};

export function HierarchyPicker({
  entries,
  mode,
  values,
  excludedIds,
  disabledIds,
  disabled,
  initialParentId,
  label,
  rootLabel,
  onChange,
}: HierarchyPickerProps) {
  const { i18n } = useTranslation();
  const zh = i18n.language.startsWith("zh");
  const searchId = useId();
  const root = useRef<HTMLElement>(null);
  const [open, setOpen] = useState(false);
  const [parentId, setParentId] = useState<string | null>(
    initialParentId ?? null,
  );
  useEffect(() => {
    if (!open) return;
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      setOpen(false);
      root.current
        ?.querySelector<HTMLButtonElement>(
          ".hierarchy-selected > button:last-child",
        )
        ?.focus();
    };
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    root.current?.addEventListener("keydown", escape);
    document.addEventListener("pointerdown", outside);
    return () => {
      root.current?.removeEventListener("keydown", escape);
      document.removeEventListener("pointerdown", outside);
    };
  }, [open]);
  const [query, setQuery] = useState("");
  const [recent, setRecent] = useState<string[]>([]);
  const navigate = (id: string | null) => {
    setParentId(id);
    setQuery("");
  };
  const select = (id: string) => {
    setRecent((previous) =>
      [id, ...previous.filter((value) => value !== id)].slice(0, 5),
    );
    onChange(
      mode === "single"
        ? [id]
        : values.includes(id)
          ? values.filter((value) => value !== id)
          : [...values, id],
    );
    if (mode === "single") setOpen(false);
  };
  const visible = currentLevel(entries, parentId, query).sort(
    (a, b) => Number(recent.includes(b.id)) - Number(recent.includes(a.id)),
  );
  return (
    <section className="hierarchy-picker" aria-label={label} ref={root}>
      <div className="hierarchy-selected">
        {values.map((id) => (
          <button
            type="button"
            className="chip"
            key={id}
            disabled={disabled}
            title={hierarchyPath(entries, id)
              .map((entry) => entry.title)
              .join(" / ")}
            onClick={() => onChange(values.filter((value) => value !== id))}
          >
            {entries.find((entry) => entry.id === id)?.title ?? id} ×
          </button>
        ))}
        <button
          type="button"
          className="chip"
          disabled={disabled}
          aria-expanded={open}
          onClick={() => setOpen(!open)}
        >
          {values.length ? (zh ? "更改 / 添加" : "Change / Add") : label}
        </button>
      </div>
      {open && (
        <div className="hierarchy-browser">
          <nav aria-label={zh ? "层级路径" : "Hierarchy path"}>
            <button
              type="button"
              className="text-button"
              onClick={() => navigate(null)}
            >
              {rootLabel}
            </button>
            {hierarchyPath(entries, parentId).map((entry) => (
              <span key={entry.id}>
                {" "}
                /{" "}
                <button
                  type="button"
                  className="text-button"
                  onClick={() => navigate(entry.id)}
                >
                  {entry.title}
                </button>
              </span>
            ))}
          </nav>
          <label htmlFor={searchId}>
            {zh ? "搜索当前层" : "Search current level"}
          </label>
          <input
            id={searchId}
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          {mode === "single" && (
            <button
              type="button"
              className="chip"
              disabled={disabled}
              onClick={() => {
                onChange([]);
                setOpen(false);
              }}
            >
              {rootLabel}
            </button>
          )}
          <ul
            aria-label={label}
            onKeyDown={(event) => {
              if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key))
                return;
              const buttons = Array.from(
                event.currentTarget.querySelectorAll<HTMLButtonElement>(
                  "button:not(:disabled)",
                ),
              );
              const index = buttons.indexOf(event.target as HTMLButtonElement);
              if (index < 0) return;
              event.preventDefault();
              const next =
                event.key === "Home"
                  ? 0
                  : event.key === "End"
                    ? buttons.length - 1
                    : index + (event.key === "ArrowDown" ? 1 : -1);
              buttons[Math.max(0, Math.min(buttons.length - 1, next))]?.focus();
            }}
          >
            {visible.map((entry) => {
              const blocked =
                disabled ||
                excludedIds?.has(entry.id) ||
                disabledIds?.has(entry.id);
              const children = entries.some(
                (candidate) => candidate.parentId === entry.id,
              );
              return (
                <li key={entry.id} className="parent-tree-row">
                  <button
                    type="button"
                    className="parent-tree-choice"
                    disabled={disabled || excludedIds?.has(entry.id)}
                    onClick={() =>
                      children
                        ? navigate(entry.id)
                        : !blocked && select(entry.id)
                    }
                  >
                    {entry.title}
                    {children && " ›"}
                  </button>
                  <button
                    type="button"
                    className="chip"
                    aria-pressed={values.includes(entry.id)}
                    disabled={blocked}
                    onClick={() => select(entry.id)}
                  >
                    {values.includes(entry.id) ? "✓" : zh ? "选择" : "Select"}
                  </button>
                </li>
              );
            })}
          </ul>
          {!visible.length && (
            <p className="muted">
              {zh ? "当前层没有匹配项" : "No matches at this level"}
            </p>
          )}
          <button
            type="button"
            className="text-button"
            onClick={() => setOpen(false)}
          >
            {zh ? "完成" : "Done"}
          </button>
        </div>
      )}
    </section>
  );
}
