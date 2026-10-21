import { useContext, useEffect, useId, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { AnchoredFloatingSurface } from "../../app/AnchoredFloatingSurface";
import { Button } from "../../components/ui/Button";
import { EntityPickerRow } from "../../components/ui/EntityPickerRow";
import { pickerKeyboard } from "../../components/ui/picker-keyboard";
import { buildHierarchyIndex, type HierarchyEntry } from "./hierarchy";
import { PickerIdentityContext } from "./PickerIdentityContext";
import { cleanRecent, recentKey } from "./recent";

export type HierarchyPickerProps = {
  kind?: "PROJECT" | "DOCUMENT" | "SPACE";
  accessibleIds?: ReadonlySet<string>;
  entries: readonly HierarchyEntry[];
  mode: "single" | "multiple";
  values: readonly string[];
  excludedIds?: ReadonlySet<string>;
  disabledIds?: ReadonlySet<string>;
  disabled?: boolean;
  allowClear?: boolean;
  initialParentId?: string | null;
  label: string;
  rootLabel: string;
  onChange(values: string[]): void;
};

export function HierarchyPicker({
  entries,
  kind = "PROJECT",
  accessibleIds,
  mode,
  values,
  excludedIds,
  disabledIds,
  disabled,
  allowClear = true,
  initialParentId,
  label,
  rootLabel,
  onChange,
}: HierarchyPickerProps) {
  const { i18n } = useTranslation();
  const zh = i18n.language.startsWith("zh");
  const searchId = useId();
  const index = useMemo(() => buildHierarchyIndex(entries), [entries]);
  const root = useRef<HTMLElement>(null);
  const anchor = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [parentId, setParentId] = useState<string | null>(
    initialParentId ?? null,
  );
  const [query, setQuery] = useState("");
  const identity = useContext(PickerIdentityContext);
  const key = identity ? recentKey(identity, kind) : null;
  const [storedRecent, setStoredRecent] = useState<{
    key: string | null;
    ids: string[];
  }>({ key: null, ids: [] });
  const recent = storedRecent.key === key ? storedRecent.ids : [];
  const setRecent = (ids: string[]) =>
    setStoredRecent((previous) =>
      previous.key === key &&
      previous.ids.length === ids.length &&
      previous.ids.every((id, index) => id === ids[index])
        ? previous
        : { key, ids },
    );
  useEffect(() => {
    if (!key) {
      setRecent([]);
      return;
    }
    const accessible =
      accessibleIds ?? new Set(entries.map((entry) => entry.id));
    try {
      const ids = cleanRecent(
        JSON.parse(localStorage.getItem(key) ?? "[]"),
        accessible,
      );
      setRecent(ids);
      localStorage.setItem(key, JSON.stringify(ids));
    } catch {
      setRecent([]);
    }
  }, [key, entries, accessibleIds]);
  const navigate = (id: string | null) => {
    setParentId(id);
    setQuery("");
  };
  const select = (id: string) => {
    const next = [id, ...recent.filter((value) => value !== id)].slice(0, 5);
    setRecent(next);
    if (key)
      try {
        localStorage.setItem(key, JSON.stringify(next));
      } catch {
        /* Browser preferences remain usable when storage is unavailable. */
      }
    onChange(
      mode === "single"
        ? [id]
        : values.includes(id)
          ? values.filter((value) => value !== id)
          : [...values, id],
    );
    if (mode === "single") setOpen(false);
  };
  const visible = useMemo(() => {
    if (!open) return [];
    const search = query.trim().toLocaleLowerCase();
    return [...(index.childrenByParentId.get(parentId) ?? [])]
      .filter((entry) => index.searchTextById.get(entry.id)?.includes(search))
      .sort(
        (a, b) => Number(recent.includes(b.id)) - Number(recent.includes(a.id)),
      );
  }, [index, parentId, query, recent, open]);
  return (
    <section
      className="hierarchy-picker"
      data-picker-kind={kind}
      aria-label={label}
      ref={root}
    >
      <div className="hierarchy-selected">
        {values.map((id) => (
          <Button
            type="button"
            variant="toggle"
            key={id}
            disabled={disabled}
            title={index
              .path(id)
              .map((entry) => entry.title)
              .join(" / ")}
            onClick={() => onChange(values.filter((value) => value !== id))}
          >
            {index.byId.get(id)?.title ?? id} ×
          </Button>
        ))}
        <Button
          type="button"
          variant="toggle"
          disabled={disabled}
          ref={anchor}
          aria-expanded={open}
          onClick={() => setOpen(!open)}
        >
          {values.length ? (zh ? "更改 / 添加" : "Change / Add") : label}
        </Button>
      </div>
      {open && (
        <AnchoredFloatingSurface
          anchorRef={anchor}
          onDismiss={() => setOpen(false)}
          label={label}
          className="hierarchy-browser"
          placement="bottom-start"
        >
          <nav aria-label={zh ? "层级路径" : "Hierarchy path"}>
            <Button
              variant="ghost"
              type="button"
              onClick={() => navigate(null)}
            >
              {rootLabel}
            </Button>
            {index.path(parentId).map((entry) => (
              <span key={entry.id}>
                {" "}
                /{" "}
                <Button
                  variant="ghost"
                  type="button"
                  onClick={() => navigate(entry.id)}
                >
                  {entry.title}
                </Button>
              </span>
            ))}
          </nav>
          {parentId && (
            <Button
              variant="ghost"
              onClick={() =>
                navigate(index.byId.get(parentId)?.parentId ?? null)
              }
            >
              {zh ? "返回上一级" : "Back one level"}
            </Button>
          )}
          <label htmlFor={searchId}>
            {zh ? "搜索当前层" : "Search current level"}
          </label>
          <input
            id={searchId}
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown") {
                event.preventDefault();
                event.currentTarget
                  .closest(".hierarchy-browser")
                  ?.querySelector<HTMLButtonElement>(
                    ".ui-entity-picker-choice:not(:disabled)",
                  )
                  ?.focus();
              }
            }}
          />
          {mode === "single" && allowClear && (
            <Button
              type="button"
              variant="toggle"
              disabled={disabled}
              onClick={() => {
                onChange([]);
                setOpen(false);
              }}
            >
              {rootLabel}
            </Button>
          )}
          <ul
            aria-label={label}
            onKeyDown={(event) =>
              pickerKeyboard(
                event,
                parentId
                  ? () => navigate(index.byId.get(parentId)?.parentId ?? null)
                  : undefined,
              )
            }
          >
            {visible.map((entry) => {
              const blocked =
                disabled ||
                excludedIds?.has(entry.id) ||
                disabledIds?.has(entry.id);
              const children =
                (index.childrenByParentId.get(entry.id)?.length ?? 0) > 0;
              return (
                <EntityPickerRow
                  key={entry.id}
                  title={entry.title}
                  description={
                    query
                      ? index
                          .path(entry.id)
                          .map((value) => value.title)
                          .join(" / ")
                      : undefined
                  }
                  path={index
                    .path(entry.id)
                    .map((value) => value.title)
                    .join(" / ")}
                  selected={values.includes(entry.id)}
                  disabled={!!blocked}
                  exploreDisabled={!!(disabled || excludedIds?.has(entry.id))}
                  exploreLabel={
                    (zh ? "浏览子项：" : "Browse children: ") + entry.title
                  }
                  onSelect={() => select(entry.id)}
                  onExplore={children ? () => navigate(entry.id) : undefined}
                />
              );
            })}
          </ul>
          {!visible.length && (
            <p className="muted">
              {zh ? "当前层没有匹配项" : "No matches at this level"}
            </p>
          )}
          <Button variant="ghost" type="button" onClick={() => setOpen(false)}>
            {zh ? "完成" : "Done"}
          </Button>
        </AnchoredFloatingSurface>
      )}
    </section>
  );
}
