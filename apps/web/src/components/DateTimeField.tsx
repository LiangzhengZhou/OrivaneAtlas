import { useTranslation } from "react-i18next";
import { DateField } from "./DateField";

/** Local wall-time input; callers keep conversion to their authoritative zone. */
export function DateTimeField({
  value,
  onChange,
  label,
  disabled = false,
}: {
  value: string;
  onChange(value: string): void;
  label: string;
  disabled?: boolean;
}) {
  const { i18n } = useTranslation();
  const day = value.slice(0, 10);
  const time = value.slice(11, 16);
  return (
    <div className="ui-toolbar" role="group" aria-label={label}>
      <DateField
        value={day}
        onChange={(next) => onChange(next ? `${next}T${time || "00:00"}` : "")}
        aria-label={label}
        disabled={disabled}
      />
      <input
        type="time"
        aria-label={i18n.language.startsWith("zh") ? "时间" : "Time"}
        value={time}
        disabled={disabled || !day}
        onChange={(event) =>
          onChange(`${day}T${event.target.value || "00:00"}`)
        }
      />
    </div>
  );
}
