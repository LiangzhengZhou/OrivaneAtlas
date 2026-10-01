import type { EntityRef } from "@arclattice/application";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { Snapshot } from "../bootstrap";

export function CommandPalette({
  snapshot,
  onOpen,
  onCreate,
  onClose,
}: {
  snapshot: Snapshot;
  onOpen(ref: EntityRef): void;
  onCreate(): void;
  onClose(): void;
}) {
  const { i18n } = useTranslation();
  const zh = i18n.language.startsWith("zh");
  const [query, setQuery] = useState("");
  const entries = [
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
  ]
    .filter((entry) =>
      entry.title.toLocaleLowerCase().includes(query.toLocaleLowerCase()),
    )
    .slice(0, 30);
  return (
    <div className="modal-backdrop">
      <section
        role="dialog"
        aria-modal="true"
        aria-label={zh ? "搜索与命令" : "Search and commands"}
        className="dialog"
        onKeyDown={(event) => {
          if (event.key === "Escape") onClose();
        }}
      >
        <input
          autoFocus
          type="search"
          aria-label={zh ? "搜索" : "Search"}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <button
          type="button"
          onClick={() => {
            onClose();
            onCreate();
          }}
        >
          {zh ? "新建" : "Create"}
        </button>
        <button
          type="button"
          onClick={() => {
            onClose();
            window.dispatchEvent(new CustomEvent("atlas:open"));
          }}
        >
          {zh ? "询问 Atlas" : "Ask Atlas"}
        </button>
        {entries.map((entry) => (
          <button
            type="button"
            className="agenda-item"
            key={`${entry.ref.kind}:${entry.ref.id}`}
            onClick={() => {
              onClose();
              onOpen(entry.ref);
            }}
          >
            {entry.title}
          </button>
        ))}
        <button type="button" onClick={onClose}>
          {zh ? "关闭" : "Close"}
        </button>
      </section>
    </div>
  );
}
