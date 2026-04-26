"use client";

import { useCart } from "@/store/cart";

/**
 * Inline guest badge — shows "Guest 1" etc. in the header subtitle.
 * Returns null if no guest number (session owner or no session).
 */
export function GuestBadge() {
  const guestNumber = useCart((s) => s.guestNumber);

  if (!guestNumber || guestNumber <= 0) return null;

  return (
    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-ocean-50 text-ocean-600 text-[10px] font-bold">
      Guest {guestNumber}
    </span>
  );
}
