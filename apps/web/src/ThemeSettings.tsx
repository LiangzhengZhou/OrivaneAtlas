import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Select } from "./components/ui/Surfaces";
import {
  applyThemePreferences,
  persistThemeMode,
  persistThemePalette,
  readThemeMode,
  readThemePalette,
  resolveThemeMode,
  type ThemeMode,
  type ThemePalette,
  themePalettes,
} from "./theme";
import "./theme-settings.css";

export function ThemeSettings({ controls }: { controls: boolean }) {
  const { t, i18n } = useTranslation("desk");
  const zh = i18n.language.startsWith("zh");
  const [mode, setMode] = useState<ThemeMode>(readThemeMode);
  const [palette, setPalette] = useState<ThemePalette>(readThemePalette);
  useEffect(() => {
    const apply = () => applyThemePreferences(mode, palette);
    apply();
    if (mode !== "system") return;
    const media = matchMedia("(prefers-color-scheme: dark)");
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [mode, palette]);
  if (!controls) return null;
  return (
    <div className="appearance-settings">
      <fieldset className="appearance-palette-field">
        <legend>{zh ? "配色" : "Color palette"}</legend>
        <div className="appearance-palette-grid">
          {themePalettes.map((option) => (
            <button
              key={option.id}
              type="button"
              className="appearance-palette-option"
              data-palette={option.id}
              aria-pressed={palette === option.id}
              onClick={() => {
                setPalette(option.id);
                persistThemePalette(option.id);
              }}
            >
              <span className="appearance-palette-swatch" aria-hidden="true">
                <span />
                <span />
              </span>
              <span className="appearance-palette-copy">
                <strong>{zh ? option.labelZh : option.labelEn}</strong>
                <small>
                  {zh ? option.descriptionZh : option.descriptionEn}
                </small>
              </span>
            </button>
          ))}
        </div>
      </fieldset>
      <label className="density-settings">
        {zh ? "显示模式" : "Display mode"}
        <Select
          aria-label={t("appearance")}
          value={mode}
          onChange={(event) => {
            const value = event.target.value as ThemeMode;
            setMode(value);
            persistThemeMode(value);
            document.documentElement.dataset.theme = resolveThemeMode(value);
          }}
        >
          {(["system", "light", "dark"] as const).map((value) => (
            <option key={value} value={value}>
              {t(`themes.${value}`)}
            </option>
          ))}
        </Select>
      </label>
    </div>
  );
}
