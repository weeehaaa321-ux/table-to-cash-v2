"use client";

import { useSyncExternalStore, useCallback } from "react";
import { t as translate, tReplace as translateReplace, type Lang } from "@/i18n";

const STORAGE_KEY = "ttc_lang";

let currentLang: Lang = "en";
const listeners = new Set<() => void>();

function getSnapshot(): Lang {
  return currentLang;
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

function broadcast() {
  for (const cb of listeners) cb();
}

if (typeof window !== "undefined") {
  try {
    const stored = localStorage.getItem(STORAGE_KEY) as Lang | null;
    if (stored === "ar" || stored === "en") currentLang = stored;
  } catch { /* silent */ }
}

function setLangGlobal(newLang: Lang) {
  if (newLang === currentLang) return;
  currentLang = newLang;
  try { localStorage.setItem(STORAGE_KEY, newLang); } catch { /* silent */ }
  broadcast();
}

export function useLanguage() {
  const lang = useSyncExternalStore(subscribe, getSnapshot, () => "en" as Lang);

  const setLang = useCallback((newLang: Lang) => {
    setLangGlobal(newLang);
  }, []);

  const toggleLang = useCallback(() => {
    setLangGlobal(currentLang === "en" ? "ar" : "en");
  }, []);

  const t = useCallback((key: string) => translate(key, lang), [lang]);
  const tr = useCallback(
    (key: string, replacements: Record<string, string | number>) => translateReplace(key, lang, replacements),
    [lang]
  );

  const dir = lang === "ar" ? "rtl" : "ltr";
  const isRTL = lang === "ar";

  return { lang, setLang, toggleLang, t, tr, dir, isRTL };
}
