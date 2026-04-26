// Languages supported in the system.
//
// Two surfaces:
//   1. UI chrome ('en', 'ar') — JSON files in src/i18n/ in source repo;
//      maps to infrastructure/i18n/chrome.ts in v2.
//   2. Domain content ('en', 'ar', 'ru') — DB columns name/nameAr/nameRu,
//      desc/descAr/descRu. Russian is content-only at present (no UI JSON).
//
// Domain entities own their content i18n via getLocalizedName/getLocalizedDesc-
// style methods. Chrome i18n is a presentation-layer concern.

export type Lang = "en" | "ar" | "ru";

export function isLang(value: string): value is Lang {
  return value === "en" || value === "ar" || value === "ru";
}
