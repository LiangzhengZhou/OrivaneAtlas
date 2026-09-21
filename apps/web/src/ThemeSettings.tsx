import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

type Theme = "system" | "light" | "dark";
const storageKey = "orivane-atlas.theme";
export function ThemeSettings({ controls }: { controls: boolean }) {
  const { t } = useTranslation("desk");
  const [theme, setTheme] = useState<Theme>(() => {
    try {
      const value = localStorage.getItem(storageKey);
      return value === "light" || value === "dark" ? value : "system";
    } catch {
      return "system";
    }
  });
  useEffect(() => {
    const system = matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      document.documentElement.dataset.theme =
        theme === "system" ? (system.matches ? "dark" : "light") : theme;
    };
    apply();
    system.addEventListener("change", apply);
    return () => system.removeEventListener("change", apply);
  }, [theme]);
  return controls ? (
    <label className="density-settings">
      {t("appearance")}
      <select
        aria-label={t("appearance")}
        value={theme}
        onChange={(event) => {
          const value = event.target.value as Theme;
          setTheme(value);
          try {
            localStorage.setItem(storageKey, value);
          } catch {}
        }}
      >
        {(["system", "light", "dark"] as const).map((value) => (
          <option key={value} value={value}>
            {t(`themes.${value}`)}
          </option>
        ))}
      </select>
    </label>
  ) : null;
}
