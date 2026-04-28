import en from "./en.json";
import ar from "./ar.json";

export type Lang = "en" | "ar";

const dictionaries: Record<Lang, Record<string, string>> = { en, ar };

function humanizeKey(key: string): string {
  const last = key.split(".").pop() || key;
  const spaced = last.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[_-]+/g, " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

export function t(key: string, lang: Lang): string {
  const hit = dictionaries[lang]?.[key] || dictionaries.en[key];
  if (hit) return hit;
  if (process.env.NODE_ENV !== "production") {
    console.warn(`[i18n] missing key: ${key} (lang=${lang})`);
  }
  return humanizeKey(key);
}

export function tReplace(key: string, lang: Lang, replacements: Record<string, string | number>): string {
  let text = t(key, lang);
  for (const [k, v] of Object.entries(replacements)) {
    text = text.replace(`{${k}}`, String(v));
  }
  return text;
}

export function getLocalizedName(item: { name: string; nameAr?: string | null }, lang: Lang): string {
  if (lang === "ar" && item.nameAr) return item.nameAr;
  return item.name;
}

export function getLocalizedDesc(item: { description?: string | null; descAr?: string | null }, lang: Lang): string {
  if (lang === "ar" && item.descAr) return item.descAr;
  return item.description || "";
}
