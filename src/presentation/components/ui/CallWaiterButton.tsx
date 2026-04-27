"use client";

import { useState } from "react";
import { useCart } from "@/store/cart";
import { motion, AnimatePresence } from "framer-motion";
import { useLanguage } from "@/lib/use-language";

/**
 * Floating "Call Waiter" button — shown on all guest pages.
 * Sends a push notification to the assigned waiter via the messages API.
 */
export function CallWaiterButton() {
  const { lang } = useLanguage();
  const sessionId = useCart((s) => s.sessionId);
  const [sent, setSent] = useState(false);
  const [sending, setSending] = useState(false);

  const tableNumber = typeof window !== "undefined" ? localStorage.getItem("ttc_tableNumber") || "1" : "1";
  const restaurant = process.env.NEXT_PUBLIC_RESTAURANT_SLUG || "neom-dahab";

  const handleCall = async () => {
    if (sending || sent) return;
    setSending(true);
    try {
      await fetch("/api/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "command",
          from: "guest",
          to: "all",
          text: lang === "ar"
            ? `طاولة ${tableNumber} تطلب النادل`
            : `Table ${tableNumber} is calling the waiter`,
          tableId: parseInt(tableNumber),
          command: "call_waiter",
          restaurantId: restaurant,
          sessionId,
        }),
      });
      setSent(true);
      setTimeout(() => setSent(false), 15000);
    } catch { /* silent */ }
    setSending(false);
  };

  return (
    <motion.div
      className="fixed bottom-36 right-6 z-50 flex flex-col items-center gap-1"
      initial={{ scale: 0, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      transition={{ type: "spring", damping: 14, delay: 0.3 }}
    >
      <button
        onClick={handleCall}
        disabled={sending || sent}
        className={`w-12 h-12 rounded-full shadow-lg flex items-center justify-center ring-2 ring-white transition-all active:scale-90 ${
          sent
            ? "bg-status-good-500 shadow-status-good-500/30"
            : "bg-status-warn-500 shadow-status-warn-500/30 hover:bg-status-warn-600"
        }`}
      >
        {sent ? (
          <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
          </svg>
        ) : (
          <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M14.857 17.082a23.848 23.848 0 005.454-1.31A8.967 8.967 0 0118 9.75v-.7V9A6 6 0 006 9v.75a8.967 8.967 0 01-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 01-5.714 0m5.714 0a3 3 0 11-5.714 0" />
          </svg>
        )}
      </button>
      <AnimatePresence>
        {sent ? (
          <motion.span
            className="text-[9px] font-bold text-status-good-600 bg-white/90 px-1.5 py-0.5 rounded-md shadow-sm"
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
          >
            {lang === "ar" ? "تم!" : "Sent!"}
          </motion.span>
        ) : (
          <motion.span
            className="text-[9px] font-bold text-status-warn-700 bg-white/90 px-1.5 py-0.5 rounded-md shadow-sm"
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
          >
            {lang === "ar" ? "نادي النادل" : "Call Waiter"}
          </motion.span>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
