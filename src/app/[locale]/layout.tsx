import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { LOCALES, isLocale, localeDir, makeI18n } from "@/lib/i18n-core";
import "../fonts";
import "../globals.css";

export function generateStaticParams() {
  return LOCALES.map((locale) => ({ locale }));
}

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const { t } = makeI18n(isLocale(locale) ? locale : "en");
  return {
    title: t("brand.product"),
    description: t("brand.company"),
    icons: { icon: "/brand/favicon.png", apple: "/brand/icon.png" },
  };
}

export default async function LocaleLayout({ children, params }: { children: React.ReactNode; params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  return (
    <html lang={locale} dir={localeDir(locale)}>
      <body>{children}</body>
    </html>
  );
}
