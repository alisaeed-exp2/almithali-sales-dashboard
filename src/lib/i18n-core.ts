// Locale data and translation, safe to use on the server and the client.
import en from "@/messages/en.json";
import ar from "@/messages/ar.json";
import type { Metric, QDim } from "./dash-types";
import { productName, tidyName } from "./normalize";
export const LOCALES = ["en", "ar"] as const;
export type Locale = (typeof LOCALES)[number];
export const isLocale = (x: string): x is Locale => (LOCALES as readonly string[]).includes(x);
export const localeDir = (l: Locale) => (l === "ar" ? "rtl" : "ltr");

type Dict = { [k: string]: string | Dict };
const MESSAGES: Record<Locale, Dict> = { en: en as Dict, ar: ar as Dict };

export type T = (key: string, vars?: Record<string, string | number>) => string;

export interface I18n {
  locale: Locale;
  dir: "ltr" | "rtl";
  /** Translate a message key, interpolating {placeholders}. Falls back to English, then the key. */
  t: T;
  /** Display label for a data value (city, channel, product…). Filters keep the raw value. */
  v: (value: string) => string;
  dimLabel: (k: QDim) => string;
  metricLabel: (m: Metric) => string;
  /** Intl locale for dates: Gregorian calendar, Latin digits in both languages. */
  intl: string;
}

function lookup(dict: Dict, key: string): string | undefined {
  let cur: string | Dict | undefined = dict;
  for (const part of key.split(".")) {
    if (cur === undefined || typeof cur === "string") return undefined;
    cur = cur[part];
  }
  return typeof cur === "string" ? cur : undefined;
}

export function makeI18n(locale: Locale): I18n {
  const dict = MESSAGES[locale];
  const t: T = (key, vars) => {
    const raw = lookup(dict, key) ?? lookup(MESSAGES.en, key) ?? key;
    return vars ? raw.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m)) : raw;
  };
  const values = (dict.values ?? {}) as Dict;
  return {
    locale,
    dir: localeDir(locale),
    t,
    // Translated label when one exists; products lose their [code] prefix; ALL-CAPS multi-word names are shown in Title Case.
    v: (value) => {
      if (typeof values[value] === "string") return values[value] as string;
      if (value.startsWith("[")) return productName(value);
      // Only multi-word names are re-cased; codes such as route "MC011" or "R.DC" stay as they are.
      return value.includes(" ") ? tidyName(value) : value;
    },
    dimLabel: (k) => t(`dim.${k}`),
    metricLabel: (m) => t(`metric.${m}`),
    intl: locale === "ar" ? "ar-SA-u-ca-gregory-nu-latn" : "en-GB",
  };
}
