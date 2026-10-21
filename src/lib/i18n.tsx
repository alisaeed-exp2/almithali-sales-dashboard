"use client";
import { createContext, useContext, useMemo, type ReactNode } from "react";
import { makeI18n, type I18n, type Locale } from "./i18n-core";

export type { I18n, Locale };


const Ctx = createContext<I18n>(makeI18n("en"));

export function I18nProvider({ locale, children }: { locale: Locale; children: ReactNode }) {
  const value = useMemo(() => makeI18n(locale), [locale]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useI18n = () => useContext(Ctx);
