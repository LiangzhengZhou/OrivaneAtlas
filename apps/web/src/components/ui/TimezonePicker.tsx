import { requireCalendarTimezone } from "@arclattice/domain";
import { useTranslation } from "react-i18next";
import { ComboboxPicker } from "./ComboboxPicker";

/** Canonical IANA values remain internal; normal rows use localized time names. */
export function timezoneLabel(timezone: string, locale: string): string {
  const formatter = new Intl.DateTimeFormat(locale, {
    timeZone: requireCalendarTimezone(timezone),
    timeZoneName: "longGeneric",
  });
  return (
    formatter
      .formatToParts(new Date("2026-01-15T12:00:00Z"))
      .find((part) => part.type === "timeZoneName")?.value ?? timezone
  );
}

export function TimezonePicker({
  value,
  onChange,
  disabled,
}: {
  value: string;
  onChange(value: string): void;
  disabled?: boolean;
}) {
  const { i18n } = useTranslation();
  const zones = [
    ...new Set([
      value,
      Intl.DateTimeFormat().resolvedOptions().timeZone,
      "UTC",
      "Asia/Shanghai",
      "Asia/Tokyo",
      "America/New_York",
      "America/Los_Angeles",
      "Europe/Berlin",
      "Europe/London",
      "Australia/Sydney",
    ]),
  ];
  return (
    <ComboboxPicker
      label={i18n.language.startsWith("zh") ? "时区" : "Timezone"}
      value={value}
      options={zones.map((zone) => ({
        value: zone,
        label: timezoneLabel(zone, i18n.language),
      }))}
      disabled={disabled ?? false}
      onChange={(zone) => onChange(requireCalendarTimezone(zone))}
    />
  );
}
