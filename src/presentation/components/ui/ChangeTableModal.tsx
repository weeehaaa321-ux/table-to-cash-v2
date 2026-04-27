"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useCart } from "@/store/cart";
import { useLanguage } from "@/lib/use-language";
import Link from "next/link";

/**
 * Shared "Move to another table" button + modal.
 * Shows on all guest pages for the session owner.
 * After a successful move, shows a transition screen with a link to the new table's menu.
 */
export function ChangeTableButton({ tableNumber, restaurant }: { tableNumber: string; restaurant: string }) {
  const { lang, dir } = useLanguage();
  const sessionId = useCart((s) => s.sessionId);
  const isSessionOwner = useCart((s) => s.isSessionOwner);

  const [showModal, setShowModal] = useState(false);
  const [newTableNum, setNewTableNum] = useState("");
  const [changingTable, setChangingTable] = useState(false);
  const [changeTableError, setChangeTableError] = useState("");
  const [movedToTable, setMovedToTable] = useState<{ oldTable: string; newTable: string } | null>(null);

  if (!isSessionOwner || !sessionId) return null;

  // Transition screen after move
  if (movedToTable) {
    const newMenuUrl = `/menu?table=${movedToTable.newTable}&restaurant=${restaurant}${sessionId ? `&session=${sessionId}` : ""}`;
    return (
      <div className="fixed inset-0 z-[60] flex items-center justify-center" dir={dir}>
        <div className="absolute inset-0 bg-gradient-to-b from-ocean-50 to-white" />
        <div className="relative flex flex-col items-center justify-center px-6 text-center max-w-sm">
          <motion.div
            className="w-20 h-20 rounded-full bg-status-good-100 flex items-center justify-center mb-5"
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ type: "spring", damping: 12 }}
          >
            <svg className="w-10 h-10 text-status-good-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </motion.div>
          <motion.h2
            className="text-xl font-semibold text-text-primary mb-2"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
          >
            {lang === "ar" ? "تم النقل بنجاح!" : "You've moved!"}
          </motion.h2>
          <motion.div
            className="flex items-center gap-2 mb-2"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.3 }}
          >
            <span className="px-3 py-1.5 rounded-xl bg-sand-200 text-text-secondary text-sm font-bold">
              {lang === "ar" ? `طاولة ${movedToTable.oldTable}` : `Table ${movedToTable.oldTable}`}
            </span>
            <svg className="w-5 h-5 text-ocean-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
            </svg>
            <span className="px-3 py-1.5 rounded-xl bg-ocean-100 text-ocean-700 text-sm font-semibold">
              {lang === "ar" ? `طاولة ${movedToTable.newTable}` : `Table ${movedToTable.newTable}`}
            </span>
          </motion.div>
          <motion.p
            className="text-text-muted text-xs mb-8 max-w-xs font-light"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.4 }}
          >
            {lang === "ar"
              ? "جميع طلباتك تم نقلها. النادل والمطبخ تم إخطارهم."
              : "All your orders have been transferred. Waiter and kitchen notified."}
          </motion.p>
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.5 }}
            className="w-full"
          >
            <Link
              href={newMenuUrl}
              onClick={() => {
                try { sessionStorage.removeItem("ttc_self_moved"); } catch {}
              }}
              className="block w-full px-8 py-4 rounded-2xl font-bold text-[15px] text-white text-center shadow-lg shadow-ocean-500/25 bg-ocean-600 hover:bg-ocean-700 transition-colors"
            >
              {lang === "ar" ? `افتح قائمة طاولة ${movedToTable.newTable}` : `Go to Table ${movedToTable.newTable} Menu`}
            </Link>
          </motion.div>
        </div>
      </div>
    );
  }

  return (
    <>
      {/* Trigger button */}
      <button
        onClick={() => setShowModal(true)}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-sand-100 text-text-secondary text-xs font-semibold hover:bg-sand-200 transition-colors"
      >
        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 21L3 16.5m0 0L7.5 12M3 16.5h13.5m0-13.5L21 7.5m0 0L16.5 12M21 7.5H7.5" />
        </svg>
        {lang === "ar" ? "نقل لطاولة أخرى" : "Move table"}
      </button>

      {/* Modal */}
      <AnimatePresence>
        {showModal && (
          <motion.div
            className="fixed inset-0 z-50 flex items-center justify-center px-6"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => { setShowModal(false); setChangeTableError(""); }} />
            <motion.div
              className="relative w-full max-w-sm bg-white rounded-3xl p-6 shadow-2xl"
              initial={{ scale: 0.9, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.9, y: 20 }}
              transition={{ type: "spring", damping: 22, stiffness: 300 }}
            >
              <div className="text-center mb-5">
                <div className="w-14 h-14 rounded-full bg-ocean-100 flex items-center justify-center mx-auto mb-3">
                  <svg className="w-7 h-7 text-ocean-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 21L3 16.5m0 0L7.5 12M3 16.5h13.5m0-13.5L21 7.5m0 0L16.5 12M21 7.5H7.5" />
                  </svg>
                </div>
                <h3 className="text-lg font-semibold text-text-primary">
                  {lang === "ar" ? "نقل لطاولة أخرى" : "Move to another table"}
                </h3>
                <p className="text-xs text-text-muted mt-1">
                  {lang === "ar" ? "أدخل رقم الطاولة الجديدة" : "Enter the new table number"}
                </p>
              </div>

              <input
                type="number"
                placeholder={lang === "ar" ? "رقم الطاولة" : "Table number"}
                value={newTableNum}
                onChange={(e) => { setNewTableNum(e.target.value); setChangeTableError(""); }}
                className="w-full px-4 py-3 rounded-2xl border border-sand-200 bg-sand-50 text-center text-lg font-bold text-text-secondary focus:outline-none focus:ring-2 focus:ring-ocean-200 mb-3"
                autoFocus
              />

              {changeTableError && (
                <p className="text-xs text-status-bad-500 text-center mb-3 font-medium">{changeTableError}</p>
              )}

              {newTableNum && !changeTableError && (
                <motion.p
                  className="text-xs text-text-secondary text-center mb-3"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                >
                  {lang === "ar"
                    ? `نقل من طاولة ${tableNumber} إلى طاولة ${newTableNum}؟`
                    : `Move from Table ${tableNumber} to Table ${newTableNum}?`}
                </motion.p>
              )}

              <div className="flex gap-2">
                <button
                  onClick={() => { setShowModal(false); setNewTableNum(""); setChangeTableError(""); }}
                  className="flex-1 py-3 rounded-2xl bg-sand-100 text-text-secondary text-sm font-bold"
                >
                  {lang === "ar" ? "إلغاء" : "Cancel"}
                </button>
                <button
                  disabled={changingTable || !newTableNum}
                  onClick={async () => {
                    if (!newTableNum || !sessionId) return;
                    setChangingTable(true);
                    setChangeTableError("");
                    try {
                      const res = await fetch("/api/sessions", {
                        method: "PATCH",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ sessionId, action: "change_table", newTableNumber: newTableNum }),
                      });
                      if (res.ok) {
                        const data = await res.json();
                        localStorage.setItem("ttc_tableNumber", String(data.newTableNumber));
                        // Tell the host page (track/menu/cart) that *we*
                        // initiated this move, so its own session-poll
                        // doesn't race in and replace this success overlay
                        // with its generic "you've moved" redirect screen.
                        // Without this flag, /track's 20s poll consistently
                        // overrode the modal's confirmation before the user
                        // could read it, and the "Go to Table # Menu" button
                        // never showed. Cleared by the host overlay after
                        // 60s as a safety expiry.
                        try {
                          sessionStorage.setItem(
                            "ttc_self_moved",
                            JSON.stringify({
                              sessionId,
                              toTable: String(data.newTableNumber),
                              ts: Date.now(),
                            }),
                          );
                        } catch {}
                        setMovedToTable({ oldTable: tableNumber, newTable: String(data.newTableNumber) });
                        setShowModal(false);
                      } else {
                        const err = await res.json();
                        setChangeTableError(err.error === "Table is occupied"
                          ? (lang === "ar" ? "الطاولة مشغولة" : "That table is occupied")
                          : err.error === "Table not found"
                            ? (lang === "ar" ? "طاولة غير موجودة" : "Table not found")
                            : (lang === "ar" ? "فشل" : "Failed"));
                      }
                    } catch { setChangeTableError(lang === "ar" ? "خطأ" : "Error"); }
                    setChangingTable(false);
                  }}
                  className="flex-1 py-3 rounded-2xl bg-ocean-500 text-white text-sm font-bold disabled:opacity-40"
                >
                  {changingTable ? "..." : lang === "ar" ? "نقل" : "Yes, Move"}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
