import { useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "./Button";
import { Popover } from "./Surfaces";

export function ComboboxPicker<T extends string>({
  label,
  value,
  options,
  disabled,
  onChange,
}: {
  label: string;
  value: T;
  options: readonly { value: T; label: string; disabled?: boolean }[];
  disabled?: boolean;
  onChange(value: T): void;
}) {
  const { i18n } = useTranslation();
  const zh = i18n.language.startsWith("zh");
  const anchor = useRef<HTMLButtonElement>(null);
  const id = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const visible = options.filter((option) =>
    option.label
      .toLocaleLowerCase(i18n.language)
      .includes(query.toLocaleLowerCase(i18n.language)),
  );
  const enabled = visible.filter((option) => !option.disabled);
  const focused = enabled[Math.min(active, Math.max(0, enabled.length - 1))];
  function select(next: T) {
    onChange(next);
    setOpen(false);
    anchor.current?.focus();
  }
  return (
    <>
      <Button
        ref={anchor}
        variant="ghost"
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => {
          setQuery("");
          setActive(0);
          setOpen(!open);
        }}
      >
        {options.find((option) => option.value === value)?.label ?? label}
      </Button>
      {open && (
        <Popover
          anchorRef={anchor}
          label={label}
          onDismiss={() => setOpen(false)}
        >
          <input
            autoFocus
            role="combobox"
            aria-label={zh ? `搜索${label}` : `Search ${label}`}
            aria-expanded="true"
            aria-controls={id}
            aria-autocomplete="list"
            aria-activedescendant={
              focused ? `${id}-${visible.indexOf(focused)}` : undefined
            }
            type="search"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setActive(0);
            }}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                event.preventDefault();
                setActive((current) =>
                  Math.max(
                    0,
                    Math.min(
                      enabled.length - 1,
                      current + (event.key === "ArrowDown" ? 1 : -1),
                    ),
                  ),
                );
              } else if (event.key === "Enter" && focused) {
                event.preventDefault();
                select(focused.value);
              }
            }}
          />
          <div
            id={id}
            role="listbox"
            aria-label={label}
            className="ui-combobox-options"
          >
            {visible.map((option, index) => (
              <Button
                key={option.value}
                id={`${id}-${index}`}
                variant="ghost"
                role="option"
                aria-selected={option.value === value}
                disabled={option.disabled}
                data-active={option === focused || undefined}
                onClick={() => select(option.value)}
              >
                {option.label}
              </Button>
            ))}
            {!visible.length && <p>{zh ? "没有匹配项" : "No matches"}</p>}
          </div>
        </Popover>
      )}
    </>
  );
}
