"use client";

import { useCart } from "@/store/cart";
import { motion, AnimatePresence } from "framer-motion";
import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * Floating cart icon — shown on all guest pages except /cart.
 * Always visible (shows empty cart when 0 items, badge when items present).
 */
export function FloatingCart() {
  const totalItems = useCart((s) => s.totalItems);
  const sessionId = useCart((s) => s.sessionId);
  const pathname = usePathname();

  const count = totalItems();

  // Hide on cart page only
  if (pathname === "/cart") return null;

  const table = typeof window !== "undefined" ? localStorage.getItem("ttc_tableNumber") || "1" : "1";

  return (
    <AnimatePresence>
      <motion.div
        className="fixed bottom-20 right-6 z-50"
        initial={{ scale: 0, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0, opacity: 0 }}
        transition={{ type: "spring", damping: 14 }}
      >
        <Link href={`/cart?table=${table}${sessionId ? `&session=${sessionId}` : ""}`}>
          <div className={`w-12 h-12 rounded-full shadow-lg flex items-center justify-center ring-2 ring-white relative ${count > 0 ? "bg-sand-900 shadow-sand-900/30" : "bg-sand-600/80 shadow-sand-600/20"}`}>
            <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 100 4 2 2 0 000-4z" />
            </svg>
            {count > 0 && (
              <motion.div
                key={count}
                className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-ocean-500 text-white text-[10px] font-bold flex items-center justify-center"
                initial={{ scale: 1.4 }}
                animate={{ scale: 1 }}
                transition={{ type: "spring", damping: 12 }}
              >
                {count}
              </motion.div>
            )}
          </div>
        </Link>
      </motion.div>
    </AnimatePresence>
  );
}
