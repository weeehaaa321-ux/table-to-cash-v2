// ─────────────────────────────────────────────────────────────────
// Chrome i18n adapter.
//
// Source repo: src/i18n/{en,ar}.json + src/i18n/index.ts. We import
// the JSON files directly here and re-expose `t()` and `tReplace()`
// helpers. Domain content i18n (menu names, descriptions) stays on
// the entities; this is for UI labels only.
//
// Russian (ru) currently lives in DB columns only — no chrome JSON.
// When/if RU UI is added, drop a ru.json next to en/ar and extend
// the dictionaries map.
// ─────────────────────────────────────────────────────────────────

import en from "@/i18n/en.json";
import ar from "@/i18n/ar.json";
import type { Lang } from "@/domain/shared/Lang";

const dictionaries: Partial<Record<Lang, Record<string, string>>> = {
  en: en as Record<string, string>,
  ar: ar as Record<string, string>,
};

export function t(key: string, lang: Lang): string {
  return dictionaries[lang]?.[key] ?? dictionaries.en?.[key] ?? key;
}

export function tReplace(
  key: string,
  lang: Lang,
  replacements: Record<string, string | number>,
): string {
  let text = t(key, lang);
  for (const [k, v] of Object.entries(replacements)) {
    text = text.replace(`{${k}}`, String(v));
  }
  return text;
}
