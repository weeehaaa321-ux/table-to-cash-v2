"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useCart } from "@/store/cart";
import { startPoll } from "@/lib/polling";

/**
 * Global floating overlay for session join requests.
 * Visible on ALL guest pages when the user is the session owner.
 * Polls every 8 seconds, pauses when the tab is hidden.
 */
export function JoinRequestOverlay() {
  const isSessionOwner = useCart((s) => s.isSessionOwner);
  const sessionId = useCart((s) => s.sessionId);
  const [requests, setRequests] = useState<{ id: string; guestId: string }[]>([]);
  const handledRef = useRef<Set<string>>(new Set());
  const seenRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!isSessionOwner || !sessionId) return;

    let active = true;
    async function poll() {
      if (!active) return;
      try {
        const res = await fetch(`/api/sessions/join?sessionId=${sessionId}`);
        if (res.ok && active) {
          const data = await res.json();
          const pending = (data.requests || []).filter(
            (r: { id: string }) => !handledRef.current.has(r.id)
          );
          // Deduplicate: only show each request once (by id)
          const unique = pending.filter((r: { id: string }) => {
            if (seenRef.current.has(r.id)) return true; // already showing
            seenRef.current.add(r.id);
            return true;
          });
          setRequests(unique);
        }
      } catch { /* silent */ }
    }

    poll();
    const stop = startPoll(poll, 16000);
    return () => { active = false; stop(); };
  }, [isSessionOwner, sessionId]);

  const handleResponse = useCallback(async (requestId: string, action: "approve" | "reject") => {
    handledRef.current.add(requestId);
    seenRef.current.delete(requestId);
    setRequests((prev) => prev.filter((r) => r.id !== requestId));
    try {
      await fetch("/api/sessions/join", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestId, action }),
      });
    } catch { /* silent */ }
  }, []);

  if (!isSessionOwner || requests.length === 0) return null;

  return (
    <div className="fixed top-20 left-1/2 -translate-x-1/2 z-[60] w-[90%] max-w-[400px] space-y-2 pointer-events-none">
      <AnimatePresence>
        {requests.map((req) => (
          <motion.div
            key={req.id}
            className="bg-white rounded-2xl shadow-2xl border border-sand-200 p-4 flex items-center gap-3 pointer-events-auto"
            initial={{ y: -20, opacity: 0, scale: 0.95 }}
            animate={{ y: 0, opacity: 1, scale: 1 }}
            exit={{ y: -20, opacity: 0, scale: 0.95 }}
            transition={{ type: "spring", damping: 20 }}
          >
            <div className="w-10 h-10 rounded-full bg-ocean-100 flex items-center justify-center shrink-0 text-ocean-600">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                <circle cx="12" cy="7" r="4" />
              </svg>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold text-text-primary">Someone wants to join</p>
              <p className="text-xs text-text-secondary">Tap to accept or decline</p>
            </div>
            <div className="flex gap-1.5 shrink-0">
              <button
                onClick={() => handleResponse(req.id, "approve")}
                className="w-10 h-10 rounded-xl bg-status-good-500 text-white flex items-center justify-center text-lg active:scale-90 transition"
              >✓</button>
              <button
                onClick={() => handleResponse(req.id, "reject")}
                className="w-10 h-10 rounded-xl bg-status-bad-500 text-white flex items-center justify-center text-lg active:scale-90 transition"
              >✕</button>
            </div>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
