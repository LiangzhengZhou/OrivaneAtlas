import { type ReactNode, useId, useRef, useState } from "react";
import { Button } from "../../components/ui/Button";
import { Popover } from "../../components/ui/Surfaces";

/** Curated presentation glyphs; custom input stays bounded to a short emoji sequence. */
const emojis = [
  "📄",
  "📝",
  "📓",
  "📔",
  "📚",
  "🗂️",
  "🗒️",
  "🧾",
  "📌",
  "📎",
  "🔖",
  "🏷️",
  "🧠",
  "💡",
  "🔬",
  "🧪",
  "⚛️",
  "🧬",
  "🪐",
  "🔭",
  "🧭",
  "🗺️",
  "📊",
  "📈",
  "🧮",
  "⚙️",
  "🧩",
  "🎯",
  "🌱",
  "🌿",
  "✨",
  "✅",
];

export function EntityIcon({
  icon,
  fallback,
  label,
  defaultLabel,
  customLabel,
  applyLabel,
  onChange,
  className,
}: {
  icon: string;
  fallback: ReactNode;
  label: string;
  defaultLabel: string;
  customLabel: string;
  applyLabel: string;
  onChange(icon: string): void;
  className?: string;
}) {
  const id = useId();
  const anchor = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const commit = () => {
    const value = draft.trim();
    if (!value) return;
    onChange(value);
    setDraft("");
    setOpen(false);
  };
  return (
    <span className={"entity-icon" + (className ? " " + className : "")}>
      <button
        ref={anchor}
        type="button"
        className="entity-icon-button"
        aria-label={label}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => {
          setDraft(icon);
          setOpen((value) => !value);
        }}
      >
        {icon ? (
          <span className="entity-emoji" aria-hidden="true">
            {icon}
          </span>
        ) : (
          fallback
        )}
      </button>
      {open && (
        <Popover
          anchorRef={anchor}
          label={label}
          onDismiss={() => setOpen(false)}
        >
          <div
            className="entity-icon-grid"
            role="group"
            aria-label={label}
            id={id}
          >
            {emojis.map((emoji) => (
              <button
                key={emoji}
                type="button"
                className="entity-icon-choice"
                aria-label={emoji}
                aria-pressed={icon === emoji}
                onClick={() => {
                  onChange(emoji);
                  setOpen(false);
                }}
              >
                {emoji}
              </button>
            ))}
          </div>
          <div className="entity-icon-custom">
            <input
              aria-label={customLabel}
              placeholder={customLabel}
              value={draft}
              maxLength={16}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  commit();
                }
              }}
            />
            <Button type="button" variant="secondary" onClick={commit}>
              {applyLabel}
            </Button>
          </div>
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              onChange("");
              setOpen(false);
            }}
          >
            {defaultLabel}
          </Button>
        </Popover>
      )}
    </span>
  );
}
