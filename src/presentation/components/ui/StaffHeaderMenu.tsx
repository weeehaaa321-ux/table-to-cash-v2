"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useLanguage } from "@/lib/use-language";

type LogoutRole = "waiter" | "kitchen" | "bar" | "cashier" | "owner" | "floormanager" | "delivery";

const ROLE_KEYS = ["waiter_staff", "kitchen_staff", "bar_staff", "cashier_staff", "floormanager_staff", "delivery_staff", "dashboard_owner"];

// Mobile-only kebab menu for staff role pages. The language toggle
// used to live in here; it's now always visible in the main header
// row, so this is just schedule + logout.
//
// `lang` / `onToggleLang` props are kept (optional) for backward
// compatibility with existing call sites, but they aren't rendered.
export function StaffHeaderMenu({
  onOpenSchedule,
  scheduleLabel,
  logoutRole,
  onLogout,
}: {
  lang?: string;
  onToggleLang?: () => void;
  onOpenSchedule?: () => void;
  scheduleLabel?: string;
  logoutRole?: LogoutRole;
  onLogout?: () => void;
}) {
  const { t } = useLanguage();
  const router = useRouter();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    const onClick = () => setOpen(false);
    window.addEventListener("keydown", onKey);
    const ti = setTimeout(() => window.addEventListener("click", onClick), 0);
    return () => {
      clearTimeout(ti);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("click", onClick);
    };
  }, [open]);

  const handleLogout = () => {
    if (onLogout) { onLogout(); return; }
    try {
      sessionStorage.removeItem("ttc_staff_unlocked");
      if (logoutRole === "owner") {
        localStorage.removeItem("dashboard_owner");
      } else if (logoutRole) {
        localStorage.removeItem(`${logoutRole}_staff`);
      } else {
        for (const k of ROLE_KEYS) localStorage.removeItem(k);
      }
    } catch { /* silent */ }
    router.push("/");
  };

  return (
    <div className="sm:hidden relative" onClick={(e) => e.stopPropagation()}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-9 h-9 rounded-xl bg-sand-100 text-text-secondary flex items-center justify-center hover:bg-sand-200 transition flex-shrink-0"
        title={t("common.more") || "More"}
        aria-label="More actions"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg>
      </button>
      {open && (
        <div className="absolute end-0 top-11 z-50 w-52 rounded-xl border border-sand-200 bg-white shadow-lg py-1">
          {onOpenSchedule && (
            <button
              onClick={() => { setOpen(false); onOpenSchedule(); }}
              className="w-full flex items-center gap-3 px-3 py-2.5 text-left hover:bg-sand-50 transition"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-text-secondary"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
              <span className="text-[12px] font-bold text-text-secondary">{scheduleLabel || t("common.schedule") || "Schedule"}</span>
            </button>
          )}
          <div className="border-t border-sand-100 mt-1 pt-1">
            <button
              onClick={() => { setOpen(false); handleLogout(); }}
              className="w-full flex items-center gap-3 px-3 py-2.5 text-left hover:bg-status-bad-50 transition"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className="text-status-bad-500">
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                <polyline points="16 17 21 12 16 7" />
                <line x1="21" y1="12" x2="9" y2="12" />
              </svg>
              <span className="text-[12px] font-bold text-status-bad-600">{t("cashier.logout") || "Logout"}</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
