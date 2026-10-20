import { i18nConfig } from "../../next-i18next.config.mjs";
import en from "./en.json";
import zh_Hans from "./zh-Hans.json";
import zh_Hant from "./zh-Hant.json";

type LocaleResources = {
  [key: string]: {
    translation: Record<string, any>;
    display_name: string;
    htmlLang: string;
  };
};

export const localeResources: LocaleResources = {
  en: {
    translation: en,
    display_name: "English",
    htmlLang: "en",
  },
  "zh-Hans": {
    translation: zh_Hans,
    display_name: "简体中文",
    htmlLang: "zh-Hans",
  },
  "zh-Hant": {
    translation: zh_Hant,
    display_name: "繁體中文",
    htmlLang: "zh-Hant",
  },
};

export const DEFAULT_LOCALE = i18nConfig.defaultLocale;
