import type { EntityRef } from "@arclattice/application";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { Snapshot } from "../bootstrap";
import { Button } from "../components/ui/Button";
import { commandScore } from "./command-ranking";
import { DismissibleDialog } from "./DismissibleDialog";
import type { View } from "./navigation";

export function CommandPalette({
  snapshot,
  onOpen,
  onCreate,
  onCreateKind,
  onNavigate,
  recentKey,
  selectedDay,
  onClose,
}: {
  snapshot: Snapshot;
  onOpen(ref: EntityRef): void;
  onCreate(): void;
  onCreateKind(kind: "TASK" | "PROJECT" | "NOTE" | "JOURNAL"): void;
  onNavigate(view: View): void;
  recentKey: string;
  selectedDay?: string | undefined;
  onClose(): void;
}) {
  const { i18n } = useTranslation();
  const zh = i18n.language.startsWith("zh");
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [recent] = useState<string[]>(() => {
    try {
      const value: unknown = JSON.parse(
        localStorage.getItem(recentKey) ?? "[]",
      );
      return Array.isArray(value)
        ? value
            .filter((id): id is string => typeof id === "string")
            .slice(0, 12)
        : [];
    } catch {
      return [];
    }
  });
  const entities = useMemo(
    () => [
      ...snapshot.items
        .filter((entry) => !entry.deletedAt)
        .map((entry) => ({
          title: entry.title,
          ref: { kind: "WORK" as const, id: entry.id },
        })),
      ...snapshot.library
        .filter((entry) => !entry.deletedAt)
        .map((entry) => ({
          title: entry.title,
          ref: { kind: entry.kind, id: entry.id },
        })),
      ...snapshot.notes
        .filter((entry) => !entry.deletedAt)
        .map((entry) => ({
          title: entry.title,
          ref: { kind: "NOTE" as const, id: entry.id },
        })),
    ],
    [snapshot.items, snapshot.library, snapshot.notes],
  );
  const text = (cn: string, en: string) => (zh ? cn : en);
  const entries = entities
    .map((entry) => ({
      ...entry,
      score: commandScore(entry.title, query),
      recent: recent.indexOf(`${entry.ref.kind}:${entry.ref.id}`),
    }))
    .filter((entry) => (query.trim() ? entry.score >= 0 : entry.recent >= 0))
    .sort((a, b) => (query.trim() ? b.score - a.score : a.recent - b.recent))
    .slice(0, 30);
  const actions = [
    { title: text("新建", "Create"), run: onCreate },
    { title: text("新建任务", "New task"), run: () => onCreateKind("TASK") },
    { title: text("新建笔记", "New note"), run: () => onCreateKind("NOTE") },
    {
      title: text("新建项目", "New project"),
      run: () => onCreateKind("PROJECT"),
    },
    {
      title: selectedDay
        ? text("打开所选日期日记", "Open selected day's journal")
        : text("打开今日日记", "Open today's journal"),
      run: () => onCreateKind("JOURNAL"),
    },
    {
      title: text("询问 Atlas", "Ask Atlas"),
      run: () => window.dispatchEvent(new CustomEvent("atlas:open")),
    },
  ].filter((action) => commandScore(action.title, query) >= 0);
  const navigation = (
    [
      ["tasks", text("任务", "Tasks")],
      ["projects", text("项目", "Projects")],
      ["calendar", text("日历", "Calendar")],
      ["library", text("知识空间", "Library")],
      ["focus", text("专注", "Focus")],
      ["settings", text("设置", "Settings")],
    ] as const
  ).filter(([, title]) => commandScore(title, query) >= 0);
  const execute = (run: () => void) => {
    onClose();
    run();
  };
  return (
    <DismissibleDialog
      onRequestClose={onClose}
      aria-label={zh ? "搜索与命令" : "Search and commands"}
      className="dialog command-palette"
      onKeyDown={(event) => {
        if (event.key === "Escape") onClose();
        const buttons = [
          ...event.currentTarget.querySelectorAll<HTMLButtonElement>(
            ".command-result",
          ),
        ];
        if (
          ["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key) &&
          buttons.length
        ) {
          event.preventDefault();
          const next =
            event.key === "Home"
              ? 0
              : event.key === "End"
                ? buttons.length - 1
                : (active +
                    (event.key === "ArrowUp" ? -1 : 1) +
                    buttons.length) %
                  buttons.length;
          setActive(next);
          buttons[next]?.scrollIntoView({ block: "nearest" });
        } else if (
          event.key === "Enter" &&
          event.target instanceof HTMLInputElement
        ) {
          event.preventDefault();
          buttons[Math.min(active, buttons.length - 1)]?.click();
        }
      }}
    >
      <input
        autoFocus
        type="search"
        aria-label={zh ? "搜索" : "Search"}
        value={query}
        placeholder={text("搜索或输入命令…", "Search or type a command…")}
        aria-controls="command-results"
        aria-activedescendant={`command-result-${active}`}
        onChange={(event) => {
          setQuery(event.target.value);
          setActive(0);
        }}
      />
      <div id="command-results" className="command-results">
        <h3 className="command-group">
          {query.trim() ? text("搜索结果", "Results") : text("最近", "Recent")}
        </h3>
        {entries.map((entry, index) => (
          <Button
            id={`command-result-${index}`}
            data-active={active === index || undefined}
            variant="ghost"
            type="button"
            className="command-result"
            key={`${entry.ref.kind}:${entry.ref.id}`}
            onClick={() => {
              onClose();
              const id = `${entry.ref.kind}:${entry.ref.id}`;
              try {
                localStorage.setItem(
                  recentKey,
                  JSON.stringify(
                    [id, ...recent.filter((value) => value !== id)].slice(
                      0,
                      12,
                    ),
                  ),
                );
              } catch {
                /* Optional non-secret preference. */
              }
              onOpen(entry.ref);
            }}
          >
            {entry.title}
          </Button>
        ))}
        <h3 className="command-group">{text("操作", "Actions")}</h3>
        {actions.map((action, index) => (
          <Button
            variant="ghost"
            className="command-result"
            id={`command-result-${entries.length + index}`}
            data-active={active === entries.length + index || undefined}
            key={action.title}
            onClick={() => execute(action.run)}
          >
            {action.title}
          </Button>
        ))}
        <h3 className="command-group">{text("跳转", "Navigation")}</h3>
        {navigation.map(([view, title], index) => (
          <Button
            variant="ghost"
            className="command-result"
            id={`command-result-${entries.length + actions.length + index}`}
            data-active={
              active === entries.length + actions.length + index || undefined
            }
            key={view}
            onClick={() => execute(() => onNavigate(view))}
          >
            {title}
          </Button>
        ))}
      </div>
      <Button type="button" onClick={onClose}>
        {zh ? "关闭" : "Close"}
      </Button>
    </DismissibleDialog>
  );
}
