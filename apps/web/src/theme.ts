export type ThemeMode = "system" | "light" | "dark";
export type ThemePalette =
  | "warm-green"
  | "warm-violet"
  | "warm-orange"
  | "orange-white"
  | "cool-neutral";

export const themeStorageKey = "orivane-atlas.theme";
export const paletteStorageKey = "orivane-atlas.palette";
export const defaultPalette: ThemePalette = "warm-green";

export const themePalettes: readonly {
  id: ThemePalette;
  labelZh: string;
  labelEn: string;
  descriptionZh: string;
  descriptionEn: string;
}[] = [
  {
    id: "warm-green",
    labelZh: "暖绿",
    labelEn: "Warm green",
    descriptionZh: "暖中性底，深绿强调",
    descriptionEn: "Warm neutral with green accent",
  },
  {
    id: "warm-violet",
    labelZh: "暖紫",
    labelEn: "Warm violet",
    descriptionZh: "暖中性底，保留品牌紫",
    descriptionEn: "Warm neutral with the brand violet",
  },
  {
    id: "warm-orange",
    labelZh: "暖橙",
    labelEn: "Warm orange",
    descriptionZh: "暖中性底色，橙色强调",
    descriptionEn: "Warm neutral with a warm orange accent",
  },
  {
    id: "orange-white",
    labelZh: "橙白",
    labelEn: "Orange white",
    descriptionZh: "白色表面，暖橙强调",
    descriptionEn: "White surfaces with a warm orange accent",
  },
  {
    id: "cool-neutral",
    labelZh: "冷灰",
    labelEn: "Cool neutral",
    descriptionZh: "当前冷灰与紫蓝强调",
    descriptionEn: "The existing cool grey and violet",
  },
];

export function readThemeMode(): ThemeMode {
  try {
    const value = localStorage.getItem(themeStorageKey);
    return value === "light" || value === "dark" ? value : "system";
  } catch {
    return "system";
  }
}

export function readThemePalette(): ThemePalette {
  try {
    const value = localStorage.getItem(paletteStorageKey);
    return themePalettes.some((palette) => palette.id === value)
      ? (value as ThemePalette)
      : defaultPalette;
  } catch {
    return defaultPalette;
  }
}

export function resolveThemeMode(mode: ThemeMode): "light" | "dark" {
  if (mode !== "system") return mode;
  return matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function applyThemePreferences(
  mode: ThemeMode = readThemeMode(),
  palette: ThemePalette = readThemePalette(),
) {
  const root = document.documentElement;
  root.dataset.theme = resolveThemeMode(mode);
  root.dataset.palette = palette;
}

export function persistThemeMode(mode: ThemeMode) {
  try {
    localStorage.setItem(themeStorageKey, mode);
  } catch {}
}

export function persistThemePalette(palette: ThemePalette) {
  try {
    localStorage.setItem(paletteStorageKey, palette);
  } catch {}
}
