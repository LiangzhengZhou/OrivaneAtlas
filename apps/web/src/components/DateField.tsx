import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { AnchoredFloatingSurface } from "../app/AnchoredFloatingSurface";
import { Button, IconButton } from "./ui/Button";
import { PressableSurface } from "./ui/Content";
import { Select } from "./ui/Surfaces";
import "./date-field.css";
import { calendarMonth, formatDateField } from "../utils/date-format";

export function DateField({
  value,
  onChange,
  min = "0001-01-01",
  max = "9999-12-31",
  required = false,
  disabled = false,
  "aria-label": label,
}: {
  value: string;
  onChange(value: string): void;
  min?: string;
  max?: string;
  required?: boolean;
  disabled?: boolean;
  "aria-label"?: string;
}) {
  const { i18n } = useTranslation();
  const zh = i18n.language.startsWith("zh");
  const text = (cn: string, en: string) => (zh ? cn : en);
  const anchor = useRef<HTMLButtonElement>(null);
  const validity = useRef<HTMLInputElement>(null);
  useEffect(() => {
    validity.current?.setCustomValidity(
      value && (value < min || value > max)
        ? zh
          ? "日期超出允许范围"
          : "Date is outside the allowed range"
        : "",
    );
  }, [value, min, max, zh]);
  const [open, setOpen] = useState(false);
  const now = new Date();
  const today = [
    now.getFullYear().toString().padStart(4, "0"),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
  ].join("-");
  const [month, setMonth] = useState((value || today).slice(0, 7));
  const [year = 2026, monthNumber = 1] = month.split("-").map(Number);
  const date = (day: number) => month + "-" + String(day).padStart(2, "0");
  const allowed = (iso: string) => iso >= min && iso <= max;
  const select = (iso: string) => {
    onChange(iso);
    setOpen(false);
  };
  const shift = (delta: number) => {
    const d = new Date(0);
    d.setUTCFullYear(year, monthNumber - 1 + delta, 1);
    const y = d.getUTCFullYear();
    if (y >= 1 && y <= 9999)
      setMonth(
        String(y).padStart(4, "0") +
          "-" +
          String(d.getUTCMonth() + 1).padStart(2, "0"),
      );
  };
  const { first, days } = calendarMonth(year, monthNumber);
  const display = formatDateField(value, i18n.language);
  return (
    <>
      <Button
        ref={anchor}
        type="button"
        disabled={disabled}
        className="date-field"
        aria-label={label}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => {
          setMonth((value || today).slice(0, 7));
          setOpen(!open);
        }}
      >
        <span>{display}</span>
        <CalendarDays size={16} />
      </Button>
      <input
        ref={validity}
        className="date-field-validity"
        tabIndex={-1}
        aria-hidden="true"
        required={required}
        disabled={disabled}
        value={value}
        onChange={() => {}}
        onInvalid={(event) => {
          event.preventDefault();
          anchor.current?.focus();
          setOpen(true);
        }}
      />
      {open && (
        <AnchoredFloatingSurface
          anchorRef={anchor}
          placement="bottom-start"
          onDismiss={() => setOpen(false)}
          label={text("选择日期", "Choose date")}
          className="calendar-popover"
        >
          <div
            role="dialog"
            aria-label={label || text("选择日期", "Choose date")}
          >
            <div className="calendar-heading">
              <IconButton
                label={text("上个月", "Previous month")}
                onClick={() => shift(-1)}
              >
                <ChevronLeft size={16} />
              </IconButton>
              <strong>
                {zh
                  ? year + "年" + monthNumber + "月"
                  : new Intl.DateTimeFormat("en-US", {
                      month: "long",
                      year: "numeric",
                      timeZone: "UTC",
                    }).format(first)}
              </strong>
              <IconButton
                label={text("下个月", "Next month")}
                onClick={() => shift(1)}
              >
                <ChevronRight size={16} />
              </IconButton>
            </div>
            <div className="calendar-month-controls">
              <label>
                {text("年", "Year")}
                <input
                  type="number"
                  min={1}
                  max={9999}
                  value={year}
                  onChange={(event) => {
                    const y = Number(event.target.value);
                    if (y >= 1 && y <= 9999)
                      setMonth(
                        String(y).padStart(4, "0") +
                          "-" +
                          String(monthNumber).padStart(2, "0"),
                      );
                  }}
                />
              </label>
              <label>
                {text("月", "Month")}
                <Select
                  value={monthNumber}
                  onChange={(event) =>
                    setMonth(
                      String(year).padStart(4, "0") +
                        "-" +
                        event.target.value.padStart(2, "0"),
                    )
                  }
                >
                  {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                    <option key={m} value={m}>
                      {zh
                        ? m + "月"
                        : new Intl.DateTimeFormat("en-US", {
                            month: "long",
                            timeZone: "UTC",
                          }).format(new Date(Date.UTC(2026, m - 1, 1)))}
                    </option>
                  ))}
                </Select>
              </label>
            </div>
            <div
              className="calendar-grid"
              onKeyDown={(event) => {
                const target = event.target as HTMLButtonElement;
                const iso = target.dataset.date;
                if (!iso) return;
                const offset = (
                  {
                    ArrowLeft: -1,
                    ArrowRight: 1,
                    ArrowUp: -7,
                    ArrowDown: 7,
                  } as Record<string, number>
                )[event.key];
                if (!offset) return;
                event.preventDefault();
                const next = new Date(iso + "T12:00:00Z");
                next.setUTCDate(next.getUTCDate() + offset);
                const nextIso = next.toISOString().slice(0, 10);
                if (!allowed(nextIso)) return;
                setMonth(nextIso.slice(0, 7));
                requestAnimationFrame(() =>
                  target
                    .closest('[role="dialog"]')
                    ?.querySelector<HTMLButtonElement>(
                      '[data-date="' + nextIso + '"]',
                    )
                    ?.focus(),
                );
              }}
            >
              {(zh
                ? ["日", "一", "二", "三", "四", "五", "六"]
                : ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
              ).map((day) => (
                <span key={day}>{day}</span>
              ))}
              {Array.from({ length: first.getUTCDay() }, (_, i) => (
                <span key={"blank" + i} />
              ))}
              {Array.from({ length: days }, (_, i) => i + 1).map((day) => (
                <PressableSurface
                  key={day}
                  data-date={date(day)}
                  aria-label={date(day)}
                  aria-pressed={date(day) === value}
                  selected={date(day) === value}
                  disabled={!allowed(date(day))}
                  onSelect={() => select(date(day))}
                >
                  {day}
                </PressableSurface>
              ))}
            </div>
            <div className="calendar-actions">
              <Button
                type="button"
                disabled={!allowed(today)}
                onClick={() => select(today)}
              >
                {text("今天", "Today")}
              </Button>
              <Button type="button" onClick={() => select("")}>
                {text("清除", "Clear")}
              </Button>
            </div>
          </div>
        </AnchoredFloatingSurface>
      )}
    </>
  );
}
