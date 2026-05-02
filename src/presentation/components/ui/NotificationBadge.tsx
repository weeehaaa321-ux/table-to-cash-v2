"use client";

import { useEffect, useState, useCallback } from "react";
import { subscribeToPush } from "@/lib/push-client";

type Props = {
  staffId: string;
  role: string;
  restaurantId?: string;
};

export function NotificationBadge({ staffId, role, restaurantId = "neom-dahab" }: Props) {
  const [status, setStatus] = useState<"granted" | "denied" | "default" | "unsupported">("default");

  useEffect(() => {
    if (typeof window === "undefined" || !("Notification" in window)) {
      setStatus("unsupported");
      return;
    }
    setStatus(Notification.permission as "granted" | "denied" | "default");
  }, []);

  const handleTap = useCallback(async () => {
    if (status === "granted" || status === "unsupported") return;
    const result = await subscribeToPush(staffId, role, restaurantId);
    setStatus(result.ok ? "granted" : "denied");
  }, [status, staffId, role, restaurantId]);

  if (status === "unsupported") return null;

  return (
    <button
      onClick={handleTap}
      title={
        status === "granted" ? "Notifications active"
        : status === "denied" ? "Notifications blocked — check browser settings"
        : "Tap to enable notifications"
      }
      className={`w-9 h-9 rounded-xl flex items-center justify-center ${
        status === "granted" ? "bg-status-good-100" : status === "denied" ? "bg-status-bad-100" : "bg-status-warn-100"
      }`}
    >
      <svg className={`w-5 h-5 ${
        status === "granted" ? "text-status-good-600" : status === "denied" ? "text-status-bad-500" : "text-status-warn-500"
      }`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
      </svg>
    </button>
  );
}
