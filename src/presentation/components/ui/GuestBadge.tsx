"use client";

import { useCart } from "@/store/cart";

/**
 * Inline guest badge — shows the guest's name (or "Guest N" fallback)
 * in the header subtitle. Returns null if no guest number (session
 * owner or no session).
 */
export function GuestBadge() {
  const guestNumber = useCart((s) => s.guestNumber);
  const guestName = useCart((s) => s.guestName);

  if (!guestNumber || guestNumber <= 0) return null;

  const label = guestName && guestName.trim() ? guestName : `Guest ${guestNumber}`;

  return (
    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-ocean-50 text-ocean-600 text-[10px] font-bold max-w-[8rem] truncate">
      {label}
    </span>
  );
}
