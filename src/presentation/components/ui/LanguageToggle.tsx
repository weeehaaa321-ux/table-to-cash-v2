"use client";

export function LanguageToggle({ lang, onToggle, className }: { lang: string; onToggle: () => void; className?: string }) {
  const base = "px-3 py-2 rounded-xl text-sm font-semibold transition-all active:scale-95 shadow-sm";
  const theme = className
    ? className
    : lang === "ar"
      ? "bg-status-good-500 text-white border-2 border-status-good-600"
      : "bg-sand-800 text-white border-2 border-sand-900";

  return (
    <button
      onClick={onToggle}
      className={`${base} ${theme}`}
      title={lang === "ar" ? "Switch to English" : "التبديل للعربية"}
    >
      {lang === "ar" ? "EN" : "عربي"}
    </button>
  );
}
