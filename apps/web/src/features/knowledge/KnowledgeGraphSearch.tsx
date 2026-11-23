import { useId, useMemo, useRef, useState } from "react";
import { Button } from "../../components/ui/Button";

import "./knowledge-graph-search.css";

export function KnowledgeGraphSearch({
  entries,
  focusId,
  path,
  onChoose,
  zh,
}: {
  entries: readonly { id: string; title: string }[];
  focusId: string;
  path(id: string): string;
  onChoose(id: string): void;
  zh: boolean;
}) {
  const [query, setQuery] = useState(""),
    [page, setPage] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const listId = useId();
  const needle = query.trim().toLocaleLowerCase();
  const matches = useMemo(
    () =>
      needle
        ? entries.filter((entry) =>
            entry.title.toLocaleLowerCase().includes(needle),
          )
        : [],
    [entries, needle],
  );
  const pageSize = 20;
  const last = Math.max(0, Math.ceil(matches.length / pageSize) - 1);
  const current = Math.min(page, last);
  const start = current * pageSize;
  const shown = matches.slice(start, start + pageSize);
  function clear() {
    setQuery("");
    setPage(0);
    input.current?.focus();
  }
  return (
    <div className="knowledge-graph-search">
      <input
        type="search"
        ref={input}
        aria-label={zh ? "图谱搜索" : "Graph search"}
        value={query}
        aria-controls={shown.length ? listId : undefined}
        onChange={(event) => {
          setQuery(event.currentTarget.value);
          setPage(0);
        }}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" && shown.length) {
            event.preventDefault();
            list.current?.querySelector<HTMLButtonElement>("button")?.focus();
          }
          if (event.key === "Escape" && query) {
            event.preventDefault();
            event.stopPropagation();
            clear();
          }
        }}
      />
      {!!needle && (
        <>
          <span role="status">
            {matches.length
              ? zh
                ? `显示第 ${start + 1}–${start + shown.length} 项，共 ${matches.length} 项`
                : `Showing ${start + 1}–${start + shown.length} of ${matches.length}`
              : zh
                ? "当前范围内没有匹配的文档"
                : "No matching documents in this scope"}
          </span>
          {!!shown.length && (
            <div
              ref={list}
              id={listId}
              role="listbox"
              aria-label={zh ? "图谱搜索结果" : "Graph search results"}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  event.preventDefault();
                  event.stopPropagation();
                  clear();
                  return;
                }
                const options = Array.from(
                  event.currentTarget.querySelectorAll<HTMLButtonElement>(
                    "button",
                  ),
                );
                const index = options.indexOf(
                  document.activeElement as HTMLButtonElement,
                );
                const positions: Partial<Record<string, number>> = {
                  ArrowDown: Math.min(index + 1, options.length - 1),
                  ArrowUp: Math.max(index - 1, 0),
                  Home: 0,
                  End: options.length - 1,
                };
                const dest = positions[event.key];
                if (typeof dest === "number") {
                  event.preventDefault();
                  options[dest]?.focus();
                }
              }}
            >
              {shown.map((entry, index) => (
                <Button
                  key={entry.id}
                  role="option"
                  variant="ghost"
                  aria-selected={focusId === entry.id}
                  tabIndex={index === 0 ? 0 : -1}
                  onClick={() => {
                    onChoose(entry.id);
                    clear();
                  }}
                >
                  {path(entry.id) || entry.title}
                </Button>
              ))}
            </div>
          )}
          {last > 0 && (
            <nav aria-label={zh ? "图谱结果分页" : "Graph result pages"}>
              <Button
                variant="ghost"
                disabled={current === 0}
                onClick={() => {
                  setPage(current - 1);
                  input.current?.focus();
                }}
              >
                {zh ? "上一页" : "Previous"}
              </Button>
              <Button
                variant="ghost"
                disabled={current === last}
                onClick={() => {
                  setPage(current + 1);
                  input.current?.focus();
                }}
              >
                {zh ? "下一页" : "Next"}
              </Button>
            </nav>
          )}
          <Button variant="text" onClick={clear}>
            {zh ? "清除搜索" : "Clear search"}
          </Button>
        </>
      )}
    </div>
  );
}
