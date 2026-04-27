"use client";

import { useRouter } from "next/navigation";

const ROLE_KEYS = ["waiter_staff", "kitchen_staff", "bar_staff", "cashier_staff", "floormanager_staff", "delivery_staff", "dashboard_owner"];

type Variant = "light" | "dark";

export default function LogoutButton({
  role,
  variant = "light",
  className = "",
}: {
  role?: "waiter" | "kitchen" | "bar" | "cashier" | "owner" | "floormanager" | "delivery";
  variant?: Variant;
  className?: string;
}) {
  const router = useRouter();

  const handleLogout = () => {
    try {
      sessionStorage.removeItem("ttc_staff_unlocked");
      if (role === "owner") {
        localStorage.removeItem("dashboard_owner");
      } else if (role) {
        localStorage.removeItem(`${role}_staff`);
      } else {
        for (const k of ROLE_KEYS) localStorage.removeItem(k);
      }
    } catch { /* silent */ }
    router.push("/");
  };

  const base =
    variant === "dark"
      ? "bg-sand-800 text-white hover:bg-sand-700 border-sand-700"
      : "bg-sand-100 text-text-muted hover:text-text-primary border-sand-200";

  return (
    <button
      onClick={handleLogout}
      aria-label="Log out"
      className={`inline-flex items-center gap-1.5 px-3 h-8 rounded-full border text-[11px] font-bold uppercase tracking-wider transition active:scale-95 ${base} ${className}`}
    >
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
        <polyline points="16 17 21 12 16 7" />
        <line x1="21" y1="12" x2="9" y2="12" />
      </svg>
      Logout
    </button>
  );
}
