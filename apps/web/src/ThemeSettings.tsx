import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Select } from "./components/ui/Surfaces";

type Theme = "system" | "light" | "dark";
const storageKey = "orivane-atlas.theme";
export function ThemeSettings({ controls }: { controls: boolean }) {
  const { t, i18n } = useTranslation("desk");
  const zh = i18n.language.startsWith("zh");
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
      {zh ? "主题" : "Theme"}
      <Select
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
      </Select>
    </label>
  ) : null;
}
