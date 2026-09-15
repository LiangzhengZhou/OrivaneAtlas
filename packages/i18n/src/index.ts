import { createInstance } from "i18next";
import { initReactI18next } from "react-i18next";
import enCommon from "./locales/en-US/common.json";
import enConnected from "./locales/en-US/connected.json";
import enDesk from "./locales/en-US/desk.json";
import enErrors from "./locales/en-US/errors.json";
import enNavigation from "./locales/en-US/navigation.json";
import enSettings from "./locales/en-US/settings.json";
import enSpaces from "./locales/en-US/spaces.json";
import enWork from "./locales/en-US/work.json";
import zhCommon from "./locales/zh-CN/common.json";
import zhConnected from "./locales/zh-CN/connected.json";
import zhDesk from "./locales/zh-CN/desk.json";
import zhErrors from "./locales/zh-CN/errors.json";
import zhNavigation from "./locales/zh-CN/navigation.json";
import zhSettings from "./locales/zh-CN/settings.json";
import zhSpaces from "./locales/zh-CN/spaces.json";
import zhWork from "./locales/zh-CN/work.json";

export type Locale = "en-US" | "zh-CN";
export type LocalePreference = Locale | "system";
export const resources = {
  "en-US": {
    spaces: enSpaces,
    common: enCommon,
    connected: enConnected,
    desk: enDesk,
    navigation: enNavigation,
    work: enWork,
    settings: enSettings,
    errors: enErrors,
  },
  "zh-CN": {
    spaces: zhSpaces,
    common: zhCommon,
    connected: zhConnected,
    desk: zhDesk,
    navigation: zhNavigation,
    work: zhWork,
    settings: zhSettings,
    errors: zhErrors,
  },
};
export function resolveLocale(
  preference: string | null,
  deviceLocale: string,
): Locale {
  if (preference === "en-US" || preference === "zh-CN") return preference;
  return deviceLocale.toLowerCase().startsWith("zh") ? "zh-CN" : "en-US";
}
export async function createI18n(locale: Locale) {
  const instance = createInstance();
  await instance.use(initReactI18next).init({
    resources,
    lng: locale,
    fallbackLng: "en-US",
    defaultNS: "common",
    interpolation: { escapeValue: false },
  });
  return instance;
}
