import type { CalendarSettings as Preference } from "@arclattice/application";
import { requireCalendarTimezone } from "@arclattice/domain";
import { useState } from "react";
import { useTranslation } from "react-i18next";

export function CalendarSettings({
  settings,
  effective,
  busy,
  onSave,
}: {
  settings: Preference;
  effective: string;
  busy: boolean;
  onSave(version: number, timezone: string | null): Promise<boolean>;
}) {
  const { t } = useTranslation("desk");
  const [base, setBase] = useState(settings);
  const [timezone, setTimezone] = useState(settings.timezone ?? "");
  const [invalid, setInvalid] = useState(false);
  const dirty = timezone !== (base.timezone ?? "");
  const conflict = settings.version !== base.version;
  return (
    <form
      className="panel calendar-settings"
      onSubmit={(event) => {
        event.preventDefault();
        if (busy || conflict) return;
        try {
          const canonical = timezone.trim()
            ? requireCalendarTimezone(timezone.trim())
            : null;
          setInvalid(false);
          void onSave(base.version, canonical).then((ok) => {
            if (ok) {
              setBase({ version: base.version + 1, timezone: canonical });
              setTimezone(canonical ?? "");
            }
          });
        } catch {
          setInvalid(true);
        }
      }}
    >
      <h2>{t("workspaceTimezone")}</h2>
      <p>{t("workspaceTimezoneHint")}</p>
      <p className="muted">{t("calendarTimezone", { timezone: effective })}</p>
      <label className="field">
        <span>{t("workspaceTimezone")}</span>
        <input
          disabled={busy}
          value={timezone}
          placeholder="Asia/Shanghai"
          maxLength={100}
          list="calendar-timezones"
          onChange={(event) => {
            setTimezone(event.target.value);
            setInvalid(false);
          }}
        />
      </label>
      <datalist id="calendar-timezones">
        {[
          "UTC",
          "Asia/Shanghai",
          "Asia/Tokyo",
          "America/Los_Angeles",
          "America/New_York",
          "Europe/London",
          "Europe/Paris",
          "Pacific/Kiritimati",
        ].map((zone) => (
          <option key={zone} value={zone} />
        ))}
      </datalist>
      {invalid && <p role="alert">{t("invalidTimezone")}</p>}
      {conflict && <p role="alert">{t("errors:VERSION_CONFLICT")}</p>}
      <div className="organization-toolbar">
        <button
          className="button primary"
          disabled={busy || !dirty || conflict}
        >
          {t("common:save")}
        </button>
        <button
          type="button"
          className="button secondary"
          disabled={busy}
          onClick={() => {
            setBase(settings);
            setTimezone(settings.timezone ?? "");
            setInvalid(false);
          }}
        >
          {t("common:cancel")}
        </button>
        <button
          type="button"
          className="chip"
          disabled={busy}
          onClick={() => setTimezone("")}
        >
          {t("inheritTimezone")}
        </button>
      </div>
    </form>
  );
}
