"use client";

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";

import { useCart } from "@/store/cart";
import { PhoneFrame } from "@/presentation/components/ui/PhoneFrame";
import { useLanguage } from "@/lib/use-language";
import { LanguageToggle } from "@/presentation/components/ui/LanguageToggle";
import Link from "next/link";
import { GuestBadge } from "@/presentation/components/ui/GuestBadge";
import { JoinRequestOverlay } from "@/presentation/components/ui/JoinRequestOverlay";
import { FloatingCart } from "@/presentation/components/ui/FloatingCart";
import { ChangeTableButton } from "@/presentation/components/ui/ChangeTableModal";
import { CallWaiterButton } from "@/presentation/components/ui/CallWaiterButton";
import { PaidRoundsCard, computePaidRounds } from "@/presentation/components/ui/PaidRoundsCard";
import type { ReceiptRound } from "@/lib/receipt-image";
import { startPoll } from "@/lib/polling";
import { isSelfInitiatedMove } from "@/lib/self-move";

const STEPS_EN = [
  { key: "confirmed", label: "Order Received", icon: "clipboard-check", desc: "Your order has been confirmed" },
  { key: "preparing", label: "Preparing", icon: "fire", desc: "The kitchen is working on your food" },
  { key: "ready", label: "Ready", icon: "sparkles", desc: "Your order is ready to be served" },
  { key: "served", label: "Served", icon: "check-circle", desc: "Enjoy your meal!" },
] as const;

const STEPS_AR = [
  { key: "confirmed", label: "تم استلام الطلب", icon: "clipboard-check", desc: "تم تأكيد طلبك" },
  { key: "preparing", label: "جاري التحضير", icon: "fire", desc: "المطبخ يعمل على طعامك" },
  { key: "ready", label: "جاهز", icon: "sparkles", desc: "طلبك جاهز للتقديم" },
  { key: "served", label: "تم التقديم", icon: "check-circle", desc: "بالهنا والشفا!" },
] as const;

function StepIcon({ icon, active, done }: { icon: string; active: boolean; done: boolean }) {
  const color = done ? "text-white" : active ? "text-white" : "text-text-muted";
  if (icon === "clipboard-check") return (
    <svg className={`w-5 h-5 ${color}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  );
  if (icon === "fire") return (
    <svg className={`w-5 h-5 ${color}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M15.362 5.214A8.252 8.252 0 0112 21 8.25 8.25 0 016.038 7.048 8.287 8.287 0 009 9.6a8.983 8.983 0 013.361-6.867 8.21 8.21 0 003 2.48z" />
    </svg>
  );
  if (icon === "sparkles") return (
    <svg className={`w-5 h-5 ${color}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 00-2.455 2.456z" />
    </svg>
  );
  return (
    <svg className={`w-5 h-5 ${color}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  );
}

function getStepIndex(status: string, steps: readonly { key: string }[]) {
  if (status === "pending") return -1;
  const idx = steps.findIndex((s) => s.key === status);
  return idx >= 0 ? idx : status === "paid" ? steps.length : -1;
}

export default function TrackPageWrapper() {
  return (
    <Suspense>
      <TrackPage />
    </Suspense>
  );
}

function TrackPage() {
  const { lang, toggleLang, t, dir } = useLanguage();
  const router = useRouter();
  const STEPS = lang === "ar" ? STEPS_AR : STEPS_EN;
  const searchParams = useSearchParams();
  const tableNumber = searchParams.get("table") ?? "1";
  const orderId = searchParams.get("order");
  const sessionParam = searchParams.get("session");
  const restaurant = searchParams.get("restaurant") || process.env.NEXT_PUBLIC_RESTAURANT_SLUG || "neom-dahab";

  const isSessionOwner = useCart((s) => s.isSessionOwner);
  const hasPaymentAuthority = useCart((s) => s.hasPaymentAuthority);
  const setHasPaymentAuthority = useCart((s) => s.setHasPaymentAuthority);
  const guestNumber = useCart((s) => s.guestNumber);
  const cartSessionId = useCart((s) => s.sessionId);
  const sessionId = sessionParam || cartSessionId;

  const menuUrl = `/menu?table=${tableNumber}&restaurant=${restaurant}${sessionId ? `&session=${sessionId}` : ""}`;

  // Block direct /track navigation. Without a real session + table the
  // page would render with the misleading default ?table=1 chrome and
  // expose pay buttons. The handshake comes from /scan.
  const urlTable = searchParams.get("table");
  if (!sessionId || !urlTable) {
    return (
      <div className="min-h-dvh bg-black flex items-center justify-center p-6">
        <div className="w-full max-w-sm bg-white rounded-3xl p-8 text-center shadow-2xl">
          <div className="mx-auto w-14 h-14 rounded-2xl bg-status-warn-50 border border-status-warn-200 flex items-center justify-center mb-4">
            <svg className="w-7 h-7 text-status-warn-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v1m0 14v1m8-8h-1M5 12H4m13.66-5.66l-.7.7M6.34 17.66l-.7.7m12.02 0l-.7-.7M6.34 6.34l-.7-.7M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
            </svg>
          </div>
          <h1 className="text-xl font-semibold text-text-primary mb-2">Scan your table&apos;s QR</h1>
          <p className="text-sm text-text-secondary leading-relaxed">
            Track your order by scanning the QR code on your table.
          </p>
        </div>
      </div>
    );
  }

  const [paymentMethod, setPaymentMethod] = useState<"CASH" | "CARD" | "INSTAPAY" | null>(null);
  const [isPaying, setIsPaying] = useState(false);
  const [isPaid, setIsPaid] = useState(false);
  const [cashPending, setCashPending] = useState(false);
  const [cashConfirmed, setCashConfirmed] = useState(false);
  const [showPayConfirm, setShowPayConfirm] = useState(false);
  const [payError, setPayError] = useState<string | null>(null);
  const [sessionClosed, setSessionClosed] = useState(false);
  const [movedToTable, setMovedToTable] = useState<number | null>(null);
  const [tipAmount, setTipAmount] = useState(0);
  const [customTip, setCustomTip] = useState("");
  const [showCustomTip, setShowCustomTip] = useState(false);
  // Guest has to explicitly tap once to reveal tips + payment methods.
  // Default state is "eat first, pay later" — the overlay nudges guests
  // toward finishing their meal instead of fumbling with payment mid-bite.
  // Auto-unlocked below as soon as a payment is in flight or confirmed,
  // so returning to the page after paying doesn't re-hide the methods.
  const [paymentUnlocked, setPaymentUnlocked] = useState(false);
  const [ratings, setRatings] = useState({ food: 0, service: 0, hygiene: 0 });
  const [ratingSubmitted, setRatingSubmitted] = useState(false);
  const [delegateGuest, setDelegateGuest] = useState<number | null>(null);
  const [isDelegating, setIsDelegating] = useState(false);
  const [sessionGuestCount, setSessionGuestCount] = useState(1);
  const [consecutivePollErrors, setConsecutivePollErrors] = useState(0);
  const consecutivePollErrorsRef = useRef(0);

  const [sessionOrders, setSessionOrders] = useState<{
    id: string; orderNumber: number; status: string; total: number;
    paymentMethod?: string | null;
    paidAt?: string | null;
    guestNumber?: number | null;
    guestName?: string | null;
    items: { name: string; quantity: number; price: number }[];
  }[]>([]);

  // Rounds derived from live server data — each "round" is a set of
  // orders sharing the exact same paidAt (cashier stamps them in one
  // SQL batch). A round 1 paid earlier stays visible as the guest
  // places round 2, so nothing disappears from their screen.
  const [cachedRounds, setCachedRounds] = useState<ReceiptRound[] | null>(null);
  const liveRounds = useMemo(() => computePaidRounds(sessionOrders), [sessionOrders]);
  // Prefer live data; fall back to the post-close cache so the Download
  // button keeps working if the guest re-opens the link after the
  // session is gone from the server.
  const paidRounds: ReceiptRound[] = liveRounds.length > 0 ? liveRounds : (cachedRounds ?? []);
  // Refs so the long-lived poll closure always sees the latest rounds
  // without re-creating the interval on every new round.
  const liveRoundsRef = useRef(liveRounds);
  const cachedRoundsRef = useRef(cachedRounds);
  useEffect(() => { liveRoundsRef.current = liveRounds; }, [liveRounds]);
  useEffect(() => { cachedRoundsRef.current = cachedRounds; }, [cachedRounds]);

  const [dbOrder, setDbOrder] = useState<{
    id: string; orderNumber: number; status: string; total: number;
    guestNumber?: number | null;
    guestName?: string | null;
    items: { name: string; quantity: number; price: number }[];
  } | null>(null);

  // Persisted receipt so refresh after payment keeps showing the final bill
  type PersistedReceipt = {
    paidAt: string;
    tableNumber: string;
    paymentMethod?: string | null;
    orders: {
      id: string; orderNumber: number; total: number;
      guestNumber?: number | null;
      guestName?: string | null;
      items: { name: string; quantity: number; price: number }[];
    }[];
    tipAmount: number;
    grandTotal: number;
  };
  const [persistedReceipt, setPersistedReceipt] = useState<PersistedReceipt | null>(null);

  // Restore receipt + rounds cache from localStorage on mount
  useEffect(() => {
    if (!sessionId) return;
    try {
      const raw = localStorage.getItem(`ttc_receipt_${sessionId}`);
      if (raw) {
        const r = JSON.parse(raw) as PersistedReceipt;
        setPersistedReceipt(r);
        setIsPaid(true);
      }
      const rawRounds = localStorage.getItem(`ttc_rounds_${sessionId}`);
      if (rawRounds) setCachedRounds(JSON.parse(rawRounds) as ReceiptRound[]);
    } catch { /* silent */ }
  }, [sessionId]);

  // Persist rounds to localStorage whenever the live-derived list grows.
  // Only the safety net — once the session closes or the tab moves, the
  // Download button still has data to render. We never write a smaller
  // list than what we already cached, so a transient empty poll can't
  // wipe history.
  useEffect(() => {
    if (!sessionId || liveRounds.length === 0) return;
    try {
      localStorage.setItem(`ttc_rounds_${sessionId}`, JSON.stringify(liveRounds));
    } catch { /* silent */ }
  }, [sessionId, liveRounds]);

  // Reset the local tip entry every time a new round is settled. The
  // tip that was chosen for round 1 has already been captured and
  // handed to the cashier, so leaving it in component state would
  // double-inflate the grand total in the rounds card once round 2
  // starts. Tip is a fresh selection per round.
  const lastRoundCountRef = useRef(0);
  useEffect(() => {
    if (liveRounds.length > lastRoundCountRef.current) {
      lastRoundCountRef.current = liveRounds.length;
      setTipAmount(0);
      setCustomTip("");
      setShowCustomTip(false);
      // New round means fresh payment decision — re-lock the panel so
      // the guest explicitly taps to reveal again.
      setPaymentUnlocked(false);
    }
  }, [liveRounds.length]);

  // Auto-unlock once payment is already in motion: returning guests
  // should see the pending/confirmed state directly, not a blur over it.
  useEffect(() => {
    if (cashPending || cashConfirmed) setPaymentUnlocked(true);
  }, [cashPending, cashConfirmed]);

  // ─── Single unified poll replaces 5 separate intervals ───
  useEffect(() => {
    if (!sessionId) return;
    let active = true;

    async function guestPoll() {
      if (!active) return;
      try {
        const params = new URLSearchParams({
          sessionId: sessionId!,
          tableNumber,
          restaurantId: restaurant,
        });
        // Always send guestNumber — delegation authority is computed on
        // every poll for everyone (including the original owner, who may
        // have delegated away).
        if (guestNumber > 0) params.set("guestNumber", String(guestNumber));
        else if (isSessionOwner) params.set("guestNumber", "1");
        if (orderId) params.set("orderId", orderId);

        const res = await fetch(`/api/guest-poll?${params}`);
        if (!res.ok || !active) {
          if (!res.ok) {
            consecutivePollErrorsRef.current += 1;
            setConsecutivePollErrors(consecutivePollErrorsRef.current);
          }
          return;
        }
        // Successful response — reset error counter
        consecutivePollErrorsRef.current = 0;
        setConsecutivePollErrors(0);
        const data = await res.json();

        // Session status
        if (!data.session || data.session.status === "CLOSED") {
          // Session auto-closed once every non-cancelled order reached
          // PAID. If we have a receipt/paid state OR cached rounds from
          // the pre-close poll, keep showing them so the guest can still
          // download the receipt and rate. Otherwise show the closed
          // overlay.
          const hasRounds =
            liveRoundsRef.current.length > 0 ||
            (cachedRoundsRef.current?.length ?? 0) > 0;
          if (cashPending) {
            setCashPending(false);
            setIsPaid(true);
          } else if (persistedReceipt || isPaid || hasRounds) {
            setIsPaid(true);
          } else {
            setSessionClosed(true);
          }
          return;
        }
        // Session is OPEN but on a different table — guest moved
        if (data.session.tableNumber && String(data.session.tableNumber) !== String(tableNumber)) {
          // Skip the generic "you've moved" page when the user just
          // initiated this move from the modal — let ChangeTableButton's
          // own confirmation overlay (with the "Go to Table # Menu" link)
          // stay visible. Otherwise this poll races in and unmounts it.
          if (isSelfInitiatedMove(sessionId, data.session.tableNumber)) {
            return;
          }
          setMovedToTable(data.session.tableNumber);
          return;
        } else {
          // URL table matches session — clear any stale "moved" overlay
          // so navigating here after a move actually lands on this page
          setMovedToTable(null);
        }
        if (data.session.guestCount) setSessionGuestCount(data.session.guestCount);

        // Orders
        type MappedOrder = {
          id: string; orderNumber: number; status: string; total: number;
          paymentMethod: string | null;
          paidAt: string | null;
          guestNumber: number | null;
          guestName: string | null;
          items: { name: string; quantity: number; price: number }[];
        };
        const mapped: MappedOrder[] = (data.orders || []).map((o: {
          id: string; orderNumber: number; status: string; total: number;
          paymentMethod?: string | null;
          paidAt?: string | null;
          guestNumber?: number | null;
          guestName?: string | null;
          items: { name: string; quantity: number; price: number }[];
        }) => ({
          id: o.id,
          orderNumber: o.orderNumber,
          status: o.status?.toLowerCase() || "pending",
          total: o.total,
          paymentMethod: o.paymentMethod || null,
          paidAt: o.paidAt || null,
          guestNumber: o.guestNumber ?? null,
          guestName: o.guestName ?? null,
          items: o.items,
        }));
        setSessionOrders(mapped);

        // Cashier is the single source of truth for payment — regardless
        // of method (CASH / CARD / INSTAPAY), paidAt is only stamped once
        // the cashier confirms. Lock state is derived fresh from server
        // state every poll (NOT sticky) so a new unpaid order placed
        // after a previously-paid round cleanly resets the lock and
        // lets the guest request payment for the next round.
        const liveOrders = mapped.filter((o) => o.status !== "cancelled");
        const allPaymentConfirmed =
          liveOrders.length > 0 && liveOrders.every((o) => o.paidAt != null);
        const pendingOrder = liveOrders.find((o) => o.paymentMethod != null && o.paidAt == null);
        setCashConfirmed(allPaymentConfirmed);
        setCashPending(!!pendingOrder && !allPaymentConfirmed);
        if (pendingOrder) {
          const method = pendingOrder.paymentMethod;
          if (method === "CASH" || method === "CARD" || method === "INSTAPAY") {
            setPaymentMethod(method);
          }
        }

        // Detect a fully-paid round and persist the receipt locally so
        // a refresh after close keeps showing the final bill.
        const isOrderDone = (o: MappedOrder) => o.status === "paid";
        const allDone = mapped.length > 0 && mapped.every(isOrderDone);
        if (allDone) {
          const grand = mapped.reduce((s, o) => s + o.total, 0);
          const receipt: PersistedReceipt = {
            paidAt: new Date().toISOString(),
            tableNumber,
            paymentMethod: mapped[0].paymentMethod || null,
            orders: mapped.map((o) => ({
              id: o.id,
              orderNumber: o.orderNumber,
              total: o.total,
              guestNumber: o.guestNumber,
              guestName: o.guestName,
              items: o.items,
            })),
            tipAmount,
            grandTotal: grand + tipAmount,
          };
          setPersistedReceipt(receipt);
          setIsPaid(true);
          try {
            localStorage.setItem(`ttc_receipt_${sessionId}`, JSON.stringify(receipt));
          } catch { /* silent */ }
        } else {
          // New round started (unpaid orders exist again) — exit the
          // receipt view so the guest can track the new round.
          setIsPaid(false);
          setPersistedReceipt(null);
          try { localStorage.removeItem(`ttc_receipt_${sessionId}`); } catch { /* silent */ }
        }

        // Payment authority is derived from server delegation so the
        // original owner loses the checkout + delegate panels the moment
        // they hand payment to another guest, and the new holder gains
        // them. With no delegation recorded, the owner (guest 1) holds
        // authority by default.
        const effectiveGuest = guestNumber > 0 ? guestNumber : (isSessionOwner ? 1 : 0);
        if (data.delegation != null && data.delegation !== 0) {
          setHasPaymentAuthority(data.delegation === effectiveGuest);
        } else {
          setHasPaymentAuthority(isSessionOwner);
        }

        // Single order tracking
        if (data.trackedOrder) {
          setDbOrder({
            id: data.trackedOrder.id,
            orderNumber: data.trackedOrder.orderNumber,
            status: data.trackedOrder.status?.toLowerCase() || "pending",
            total: data.trackedOrder.total,
            guestNumber: data.trackedOrder.guestNumber ?? null,
            guestName: data.trackedOrder.guestName ?? null,
            items: data.trackedOrder.items,
          });
        }
        // Successful poll — reset error counter (catches the case where
        // res.ok was true but no early return hit the counter above)
      } catch {
        consecutivePollErrorsRef.current += 1;
        setConsecutivePollErrors(consecutivePollErrorsRef.current);
      }
    }

    guestPoll();
    // 10s — fast enough that a payment delegation handed to another
    // guest still arrives in their UI within ~10s, but conservative
    // enough to keep Vercel invocation cost in check (every guest tab
    // hits this, plus the JoinRequestOverlay at 8s). The previous 20s
    // was the single biggest cause of the "is delegation broken?"
    // complaint.
    const stop = startPoll(guestPoll, 10000);
    return () => { active = false; stop(); };
  }, [sessionId, tableNumber, restaurant, isSessionOwner, guestNumber, orderId, cashPending, setHasPaymentAuthority]);

  useEffect(() => {
    // Clear session storage only after the session itself has closed
    // server-side. isPaid alone isn't enough — a refresh mid-round
    // needs the sessionId to reattach.
    if (sessionClosed && sessionId) {
      try {
        sessionStorage.removeItem("ttc_sessionId");
        sessionStorage.removeItem(`ttc_owner_${sessionId}`);
        localStorage.removeItem("ttc_sessionId");
      } catch { /* silent */ }
    }
  }, [sessionClosed, sessionId]);

  // Build tableOrders from sessionOrders (bundled poll) or single tracked order
  type TrackOrder = {
    id: string; orderNumber: number; status: string; total: number;
    guestNumber?: number | null;
    guestName?: string | null;
    paidAt?: string | null;
    items: { name: string; quantity: number; price: number }[];
  };
  // Always show all unpaid session orders. `orderId` in the URL is a hint for
  // which one is "new" (used to highlight it) — never a filter, so a guest who
  // places multiple orders can track each of them side by side.
  const unpaidSessionOrders = sessionOrders.filter((o) => o.status.toLowerCase() !== "paid");
  let tableOrders: TrackOrder[];
  if (unpaidSessionOrders.length > 0) {
    tableOrders = unpaidSessionOrders;
  } else if (orderId && dbOrder) {
    tableOrders = [dbOrder];
  } else {
    tableOrders = [];
  }

  // Only sum orders the cashier has NOT yet settled — `paidAt == null`
  // is the authoritative "still owed" marker (mirrors the cashier's
  // unpaidTotal). The old reducer summed every order in the session
  // including paid rounds, so after round 1 settled the guest was asked
  // to pay round 1 + round 2 again, and after round 2 they were asked
  // to pay 1 + 2 + 3. The cashier was charging only the delta so no
  // double-billing actually happened, but the guest's screen was lying.
  const billableOrders = sessionOrders.length > 0
    ? sessionOrders.filter((o) => !o.paidAt && o.status.toLowerCase() !== "cancelled")
    : tableOrders;
  const invoiceTotal = billableOrders.reduce((s, o) => s + o.total, 0);
  const invoiceOrderCount = billableOrders.length;

  const leastProgressed = tableOrders.length > 0
    ? tableOrders.reduce((min, o) => getStepIndex(o.status, STEPS) < getStepIndex(min.status, STEPS) ? o : min)
    : null;

  const currentStep = leastProgressed ? getStepIndex(leastProgressed.status, STEPS) : -1;

  // Session moved to another table — show redirect
  if (movedToTable) {
    const newTrackUrl = `/track?table=${movedToTable}&restaurant=${restaurant}${sessionId ? `&session=${sessionId}` : ""}`;
    return (
      <PhoneFrame>
        <div className="h-full bg-gradient-to-b from-ocean-50 to-white flex flex-col items-center justify-center px-6 text-center" dir={dir}>
          <motion.div
            className="w-20 h-20 rounded-full bg-ocean-100 flex items-center justify-center mb-5"
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ type: "spring", damping: 12 }}
          >
            <svg className="w-10 h-10 text-ocean-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 21L3 16.5m0 0L7.5 12M3 16.5h13.5m0-13.5L21 7.5m0 0L16.5 12M21 7.5H7.5" />
            </svg>
          </motion.div>
          <h2 className="text-xl font-bold text-text-primary mb-2">
            {lang === "ar" ? "تم نقلك لطاولة أخرى" : "You've moved tables"}
          </h2>
          <p className="text-text-secondary text-sm mb-6 max-w-xs font-light">
            {lang === "ar"
              ? `جلستك الآن على طاولة ${movedToTable}`
              : `Your session is now on Table ${movedToTable}`}
          </p>
          <a
            href={newTrackUrl}
            onClick={() => setMovedToTable(null)}
            className="px-8 py-3 rounded-2xl font-bold text-sm text-white shadow-lg bg-ocean-600 hover:bg-ocean-700 transition-colors"
          >
            {lang === "ar" ? `تتبع طاولة ${movedToTable}` : `Go to Table ${movedToTable}`}
          </a>
        </div>
      </PhoneFrame>
    );
  }

  // Session closed — show closed screen
  if (sessionClosed && !isPaid) {
    return (
      <PhoneFrame>
        <div className="h-full bg-gradient-to-b from-sand-50 to-white flex flex-col items-center justify-center px-6 text-center" dir={dir}>
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
          <h2 className="text-xl font-bold text-text-primary mb-2">{t("track.sessionClosedTitle")}</h2>
          <p className="text-text-secondary text-sm mb-6 max-w-xs font-light">
            {t("track.sessionClosedDesc")}
          </p>
        </div>
      </PhoneFrame>
    );
  }

  return (
    <PhoneFrame>
      {!isPaid && <FloatingCart />}
      {!isPaid && <CallWaiterButton />}
      <JoinRequestOverlay />
      <div className="h-full bg-gradient-to-b from-sand-50 to-white overflow-y-auto" dir={dir}>
        {/* Header */}
        <div className="bg-white/80 backdrop-blur-xl sticky top-0 z-20 px-5 py-4 border-b border-sand-100/50 safe-top">
          <div className="flex items-center gap-3">
            <Link
              href={menuUrl}
              className="w-10 h-10 rounded-full bg-sand-100 flex items-center justify-center text-text-muted"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d={dir === "rtl" ? "M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" : "M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18"} />
              </svg>
            </Link>
            <div className="flex-1">
              <h1 className="text-lg font-semibold text-text-primary tracking-tight">{t("track.title")}</h1>
              <p className="text-[11px] text-text-muted font-medium flex items-center gap-1.5">
                <GuestBadge />
                {tableOrders.length > 0 && <span>{tableOrders.length} order{tableOrders.length > 1 ? "s" : ""}</span>}
              </p>
            </div>
            <LanguageToggle lang={lang} onToggle={toggleLang} />
          </div>

          {!isPaid && <ChangeTableButton tableNumber={tableNumber} restaurant={restaurant} />}
        </div>

        {/* Connection lost banner */}
        <AnimatePresence>
          {consecutivePollErrors >= 3 && (
            <motion.div
              className="mx-5 mt-3 px-4 py-2.5 rounded-xl bg-status-warn-50 border border-status-warn-200 flex items-center gap-2"
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
            >
              <motion.div
                className="w-4 h-4 border-2 border-status-warn-400 border-t-transparent rounded-full flex-shrink-0"
                animate={{ rotate: 360 }}
                transition={{ repeat: Infinity, duration: 1, ease: "linear" }}
              />
              <p className="text-xs font-bold text-status-warn-700">
                {lang === "ar" ? "انقطع الاتصال — جارٍ إعادة المحاولة..." : "Connection lost — retrying..."}
              </p>
            </motion.div>
          )}
        </AnimatePresence>

        {tableOrders.length === 0 && !isPaid && !persistedReceipt ? (
          <div className="flex flex-col items-center justify-center px-6 text-center pt-24">
            <motion.div
              className="w-20 h-20 rounded-full bg-sand-100 flex items-center justify-center mb-5"
              animate={{ scale: [1, 1.05, 1] }}
              transition={{ repeat: Infinity, duration: 3 }}
            >
              <svg className="w-8 h-8 text-text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </motion.div>
            <h2 className="text-lg font-bold text-text-primary mb-2">{t("track.noOrders")}</h2>
            <p className="text-text-muted text-sm mb-6 max-w-xs font-light">
              {t("track.noOrdersDesc")}
            </p>
            <Link
              href={menuUrl}
              className="px-8 py-3.5 rounded-2xl font-bold text-[15px] text-white bg-ocean-600 hover:bg-ocean-700 transition-colors"
            >
              {t("track.browseMenu")}
            </Link>
          </div>
        ) : (
          <div className="px-5 pt-6 pb-8">
            {/* Persistent multi-round receipt card. Appears the moment
                round 1 is settled and stays visible across every later
                round + after session close. Single Download button
                covers all rounds, so the guest never has to download
                per-round. */}
            {paidRounds.length > 0 && (
              <PaidRoundsCard
                tableNumber={tableNumber}
                rounds={paidRounds}
                tip={persistedReceipt?.tipAmount ?? tipAmount}
                lang={lang}
              />
            )}
            {/* Live status hero — hidden once paid; receipt below replaces it */}
            {!isPaid && (
            <motion.div
              className="bg-white rounded-3xl p-6 shadow-sm border border-sand-100 mb-6 text-center relative overflow-hidden"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
            >
              {/* Animated background pulse for active states */}
              {currentStep >= 0 && currentStep < 3 && (
                <motion.div
                  className="absolute inset-0 rounded-3xl"
                  style={{
                    background: currentStep === 1
                      ? "radial-gradient(circle at center, rgba(251,146,60,0.06) 0%, transparent 70%)"
                      : currentStep === 2
                        ? "radial-gradient(circle at center, rgba(52,211,153,0.06) 0%, transparent 70%)"
                        : "radial-gradient(circle at center, rgba(99,102,241,0.06) 0%, transparent 70%)"
                  }}
                  animate={{ scale: [1, 1.2, 1], opacity: [0.5, 1, 0.5] }}
                  transition={{ repeat: Infinity, duration: 3 }}
                />
              )}

              {/* Status icon */}
              <motion.div
                className={`w-16 h-16 rounded-full mx-auto mb-4 flex items-center justify-center ${
                  currentStep === -1 ? "bg-sand-100" :
                  currentStep === 0 ? "bg-ocean-100" :
                  currentStep === 1 ? "bg-status-warn-100" :
                  currentStep === 2 ? "bg-status-good-100" :
                  "bg-status-good-100"
                }`}
                key={currentStep}
                initial={{ scale: 0.5, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ type: "spring", damping: 12 }}
              >
                {currentStep === -1 ? (
                  <motion.div
                    className="w-5 h-5 border-2 border-sand-300 border-t-sand-500 rounded-full"
                    animate={{ rotate: 360 }}
                    transition={{ repeat: Infinity, duration: 1, ease: "linear" }}
                  />
                ) : (
                  <StepIcon
                    icon={STEPS[Math.min(currentStep, STEPS.length - 1)].icon}
                    active={true}
                    done={false}
                  />
                )}
              </motion.div>

              <h2 className="text-xl font-semibold text-text-primary mb-1 tracking-tight relative">
                {currentStep >= 0
                  ? STEPS[Math.min(currentStep, STEPS.length - 1)].label
                  : lang === "ar" ? "في انتظار التأكيد" : "Waiting for confirmation"}
              </h2>
              <p className="text-sm text-text-muted font-light relative">
                {currentStep >= 0
                  ? STEPS[Math.min(currentStep, STEPS.length - 1)].desc
                  : lang === "ar" ? "يتم مراجعة طلبك" : "Your order is being reviewed"}
              </p>

            </motion.div>
            )}

            {/* Progress steps — horizontal */}
            {!isPaid && (
            <div className="bg-white rounded-2xl p-5 shadow-sm border border-sand-100 mb-6">
              <div className="flex items-center justify-between relative">
                {/* Progress line */}
                <div className="absolute top-5 left-[calc(12.5%)] right-[calc(12.5%)] h-0.5 bg-sand-100 z-0" />
                <motion.div
                  className="absolute top-5 left-[calc(12.5%)] h-0.5 bg-gradient-to-r from-ocean-500 to-status-good-500 z-0"
                  initial={false}
                  animate={{
                    width: currentStep < 0 ? "0%" :
                      `${Math.min(100, (currentStep / (STEPS.length - 1)) * 100) * 0.75}%`
                  }}
                  transition={{ duration: 0.8, ease: "easeOut" }}
                />

                {STEPS.map((step, i) => {
                  const isComplete = currentStep >= i;
                  const isActive = currentStep === i;

                  return (
                    <div key={step.key} className="flex flex-col items-center relative z-10 flex-1">
                      <motion.div
                        className={`w-10 h-10 rounded-full flex items-center justify-center transition-all duration-500 ${
                          isComplete
                            ? "bg-gradient-to-br from-ocean-500 to-ocean-600 shadow-lg shadow-ocean-500/20"
                            : "bg-white border-2 border-sand-200"
                        }`}
                        animate={isActive ? { scale: [1, 1.1, 1] } : {}}
                        transition={isActive ? { repeat: Infinity, duration: 2 } : {}}
                      >
                        {isComplete ? (
                          <StepIcon icon={step.icon} active={isActive} done={true} />
                        ) : (
                          <span className="text-[11px] font-bold text-text-muted">{i + 1}</span>
                        )}
                      </motion.div>
                      <p className={`text-[10px] font-semibold mt-2 text-center transition-colors ${
                        isComplete ? "text-text-secondary" : "text-text-muted"
                      }`}>
                        {step.label}
                      </p>
                    </div>
                  );
                })}
              </div>
            </div>
            )}

            {/* All orders at this table */}
            {!isPaid && tableOrders.map((ord) => {
              const ordStep = getStepIndex(ord.status, STEPS);
              const isHighlighted = orderId === ord.id;
              return (
              <motion.div
                key={ord.id}
                className={`bg-white rounded-2xl p-4 shadow-sm mb-3 ${
                  isHighlighted ? "border-2 border-ocean-300 ring-2 ring-ocean-100" : "border border-sand-100"
                }`}
                initial={{ opacity: 0, y: 5 }}
                animate={{ opacity: 1, y: 0 }}
              >
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-bold text-text-primary flex items-center gap-2 flex-wrap">
                    Order #{ord.orderNumber}
                    {ord.guestNumber && ord.guestNumber > 0 && (
                      <span className="inline-flex items-center gap-1 text-[9px] font-bold text-ocean-600 bg-ocean-50 border border-ocean-100 rounded-full px-2 py-0.5 uppercase tracking-wider max-w-[10rem]">
                        <svg className="w-2.5 h-2.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />
                        </svg>
                        <span className="truncate">{ord.guestName && ord.guestName.trim() ? ord.guestName : `G${ord.guestNumber}`}</span>
                      </span>
                    )}
                    {/* Walk-up paid badge — prevents the guest from
                        thinking their paid order is stuck when the
                        card above already says "Round 1 paid" but the
                        status below still reads "Preparing". */}
                    {ord.paidAt && (
                      <span className="inline-flex items-center gap-1 text-[9px] font-bold text-status-good-700 bg-status-good-50 border border-status-good-200 rounded-full px-2 py-0.5 uppercase tracking-wider">
                        <svg className="w-2.5 h-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                        </svg>
                        {lang === "ar" ? "مدفوع" : "Paid"}
                      </span>
                    )}
                  </h3>
                  <span className={`text-[10px] font-bold px-2.5 py-1 rounded-full ${
                    ord.status === "ready" ? "bg-status-good-50 text-status-good-600"
                    : ord.status === "preparing" ? "bg-status-warn-50 text-status-warn-600"
                    : ord.status === "served" ? "bg-sand-100 text-text-secondary"
                    : "bg-ocean-50 text-ocean-600"
                  }`}>
                    {ord.status === "pending" ? "Received" : ord.status.charAt(0).toUpperCase() + ord.status.slice(1)}
                  </span>
                </div>

                {/* Per-order mini stepper */}
                <div className="flex items-center justify-between mb-3 px-1">
                  {STEPS.map((step, i) => {
                    const done = ordStep >= i;
                    const active = ordStep === i;
                    return (
                      <div key={step.key} className="flex-1 flex items-center">
                        <div className={`w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 transition-colors ${
                          done ? "bg-ocean-500" : "bg-sand-100"
                        } ${active ? "ring-2 ring-ocean-200" : ""}`}>
                          {done ? (
                            <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                            </svg>
                          ) : (
                            <span className="text-[9px] font-bold text-text-muted">{i + 1}</span>
                          )}
                        </div>
                        {i < STEPS.length - 1 && (
                          <div className={`flex-1 h-0.5 mx-1 ${ordStep > i ? "bg-ocean-400" : "bg-sand-100"}`} />
                        )}
                      </div>
                    );
                  })}
                </div>
                <div className="space-y-2">
                  {ord.items.map((item, i) => (
                    <div key={i} className="flex justify-between text-sm">
                      <span className="text-text-secondary">
                        <span className="font-semibold text-text-secondary">{item.quantity}x</span>{" "}
                        {item.name}
                      </span>
                      <span className="text-text-muted tabular-nums">
                        {item.price * item.quantity} EGP
                      </span>
                    </div>
                  ))}
                </div>
                <div className="border-t border-sand-100 mt-3 pt-2.5 flex justify-between text-sm">
                  <span className="font-semibold text-text-secondary">Subtotal</span>
                  <span className="font-bold text-text-primary">{ord.total} EGP</span>
                </div>
              </motion.div>
              );
            })}

            {/* Grand total if multiple orders */}
            {!isPaid && tableOrders.length > 1 && (
              <div className="bg-ocean-50 rounded-2xl p-4 border border-ocean-100 mb-4">
                <div className="flex justify-between items-center">
                  <span className="font-bold text-text-primary">Table Total</span>
                  <span className="font-semibold text-text-primary text-lg">
                    {tableOrders.reduce((s, o) => s + o.total, 0)} EGP
                  </span>
                </div>
              </div>
            )}

            {/* Payment section */}
            {isPaid ? (
              <motion.div
                className="mt-4"
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
              >
                <div className="text-center py-6">
                  <motion.div
                    className="w-20 h-20 rounded-full bg-status-good-100 flex items-center justify-center mx-auto mb-4"
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    transition={{ type: "spring", damping: 12 }}
                  >
                    <svg className="w-10 h-10 text-status-good-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                    </svg>
                  </motion.div>
                  <p className="text-xl font-semibold text-text-primary mb-2 tracking-tight">{t("track.paymentComplete")}</p>
                  <p className="text-sm text-text-muted font-light mb-2">{t("track.thankYou")}</p>
                </div>

                {/* Receipt now lives in the persistent PaidRoundsCard
                    rendered at the top of the content area — covers
                    every round in one view, so we don't duplicate it
                    here. */}

                {/* Rating */}
                {!ratingSubmitted ? (
                  <div className="bg-white rounded-2xl p-5 shadow-sm border border-sand-100">
                    <p className="text-sm font-bold text-text-primary mb-4 text-center">
                      {lang === "ar" ? "قيّم تجربتك" : "Rate Your Experience"}
                    </p>
                    {([
                      { key: "food" as const, label: lang === "ar" ? "الطعام" : "Food", icon: "🍽️" },
                      { key: "service" as const, label: lang === "ar" ? "الخدمة" : "Service", icon: "🤝" },
                      { key: "hygiene" as const, label: lang === "ar" ? "النظافة" : "Hygiene", icon: "✨" },
                    ]).map(({ key, label, icon }) => (
                      <div key={key} className="flex items-center justify-between mb-3">
                        <span className="text-sm text-text-secondary font-medium flex items-center gap-1.5">
                          <span>{icon}</span> {label}
                        </span>
                        <div className="flex gap-1">
                          {[1, 2, 3, 4, 5].map((star) => (
                            <button
                              key={star}
                              onClick={() => setRatings((prev) => ({ ...prev, [key]: star }))}
                              className="p-0.5"
                            >
                              <svg
                                className={`w-6 h-6 transition-colors ${star <= ratings[key] ? "text-status-warn-400" : "text-text-muted"}`}
                                fill={star <= ratings[key] ? "currentColor" : "none"}
                                viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}
                              >
                                <path strokeLinecap="round" strokeLinejoin="round" d="M11.48 3.499a.562.562 0 011.04 0l2.125 5.111a.563.563 0 00.475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602a.563.563 0 00-.182.557l1.285 5.385a.562.562 0 01-.84.61l-4.725-2.885a.562.562 0 00-.586 0L6.982 20.54a.562.562 0 01-.84-.61l1.285-5.386a.562.562 0 00-.182-.557l-4.204-3.602a.562.562 0 01.321-.988l5.518-.442a.563.563 0 00.475-.345L11.48 3.5z" />
                              </svg>
                            </button>
                          ))}
                        </div>
                      </div>
                    ))}
                    {(ratings.food > 0 || ratings.service > 0 || ratings.hygiene > 0) && (
                      <motion.button
                        initial={{ opacity: 0, y: 5 }}
                        animate={{ opacity: 1, y: 0 }}
                        onClick={async () => {
                          try {
                            await fetch("/api/ratings", {
                              method: "POST",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({
                                sessionId,
                                restaurantId: restaurant,
                                ...ratings,
                              }),
                            });
                            setRatingSubmitted(true);
                          } catch { /* silent */ }
                        }}
                        className="w-full mt-2 py-2.5 rounded-xl bg-sand-900 text-white text-sm font-bold"
                      >
                        {lang === "ar" ? "إرسال التقييم" : "Submit Rating"}
                      </motion.button>
                    )}
                  </div>
                ) : (
                  <div className="text-center py-3">
                    <p className="text-sm text-status-good-600 font-semibold">
                      {lang === "ar" ? "شكراً على تقييمك!" : "Thanks for your feedback!"}
                    </p>
                  </div>
                )}
              </motion.div>
            ) : hasPaymentAuthority && sessionId ? (
              <div className="mt-4">
                {/* Delegate payment — visible to whoever currently holds
                    payment authority (owner or a delegated guest) */}
                {sessionGuestCount > 1 && !cashPending && !cashConfirmed && (
                  <div className="bg-white rounded-2xl p-4 shadow-sm border border-sand-100 mb-4">
                    <p className="text-xs font-bold text-text-muted uppercase tracking-widest mb-2">
                      {lang === "ar" ? "تفويض الدفع" : "Delegate Payment"}
                    </p>
                    <p className="text-xs text-text-secondary mb-3">
                      {lang === "ar" ? "اختر رقم الضيف لتفويض صلاحية الدفع" : "Select a guest to give them payment authority"}
                    </p>
                    <div className="flex gap-2 flex-wrap mb-3">
                      {Array.from({ length: sessionGuestCount }, (_, i) => i + 1)
                        .filter((g) => g !== (guestNumber > 0 ? guestNumber : 1))
                        .map((g) => {
                          // Pull a friendly label from any order this guest
                          // already placed under their name. Falls back to
                          // "Guest N" for guests who haven't ordered (or who
                          // skipped the name prompt).
                          const named = sessionOrders.find(
                            (o) => o.guestNumber === g && o.guestName && o.guestName.trim(),
                          );
                          const label = named?.guestName?.trim()
                            || (lang === "ar" ? `الضيف ${g}` : `Guest ${g}`);
                          return (
                            <button
                              key={g}
                              onClick={() => setDelegateGuest(g)}
                              className={`px-4 py-2 rounded-xl text-sm font-bold border-2 transition-all max-w-[10rem] truncate ${
                                delegateGuest === g
                                  ? "border-ocean-500 bg-ocean-50 text-ocean-700"
                                  : "border-sand-200 bg-white text-text-secondary"
                              }`}
                            >
                              {label}
                            </button>
                          );
                        })}
                    </div>
                    {delegateGuest && (
                      <button
                        disabled={isDelegating}
                        onClick={async () => {
                          setIsDelegating(true);
                          try {
                            await fetch("/api/sessions/delegate", {
                              method: "POST",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({ sessionId, guestNumber: delegateGuest }),
                            });
                            // Flip authority locally so this panel
                            // unmounts immediately — the next poll will
                            // confirm. Without the optimistic flip the
                            // delegating guest sat staring at their own
                            // (now-stale) checkout panel for up to one
                            // poll interval, which made delegation feel
                            // broken.
                            setHasPaymentAuthority(false);
                            setDelegateGuest(null);
                          } catch { /* silent */ }
                          setIsDelegating(false);
                        }}
                        className="w-full py-2.5 rounded-xl bg-ocean-500 text-white text-sm font-bold"
                      >
                        {(() => {
                          if (isDelegating) return "...";
                          const named = sessionOrders.find(
                            (o) => o.guestNumber === delegateGuest && o.guestName && o.guestName.trim(),
                          );
                          const target = named?.guestName?.trim()
                            || (lang === "ar" ? `الضيف ${delegateGuest}` : `Guest ${delegateGuest}`);
                          return lang === "ar" ? `تفويض ${target}` : `Delegate to ${target}`;
                        })()}
                      </button>
                    )}
                  </div>
                )}

                {/* Checkout Panel — visible for session owner or delegated guest */}
                <div className="bg-white rounded-2xl p-5 shadow-sm border border-sand-100">
                  <h3 className="font-bold text-text-primary text-[15px] mb-4">{t("track.payForTable")}</h3>

                  {/* Full session invoice */}
                  <div className="bg-sand-50 rounded-xl p-4 mb-4 border border-sand-100">
                    <div className="space-y-1.5">
                      {billableOrders.length > 0 ? (
                        billableOrders.map((o) => (
                          <div key={o.id} className="flex justify-between text-xs text-text-secondary">
                            <span className="flex items-center gap-1.5">
                              Order #{o.orderNumber} ({o.items.length} items)
                              {o.guestNumber && o.guestNumber > 0 && (
                                <span className="inline-flex items-center text-[9px] font-bold text-ocean-600 bg-ocean-50 border border-ocean-100 rounded-full px-1.5 py-px max-w-[8rem] truncate">
                                  {o.guestName && o.guestName.trim() ? o.guestName : `G${o.guestNumber}`}
                                </span>
                              )}
                            </span>
                            <span className="font-semibold">{o.total} EGP</span>
                          </div>
                        ))
                      ) : (
                        <div className="flex justify-between text-xs text-text-secondary">
                          <span>{invoiceOrderCount} order{invoiceOrderCount !== 1 ? "s" : ""}</span>
                          <span className="font-semibold">{invoiceTotal} EGP</span>
                        </div>
                      )}
                    </div>
                    <div className="border-t border-sand-200 mt-2 pt-2 flex justify-between items-center">
                      <span className="text-sm font-bold text-text-secondary">{lang === "ar" ? "المجموع" : "Subtotal"}</span>
                      <span className="text-sm font-semibold text-text-primary">{invoiceTotal} EGP</span>
                    </div>
                    {tipAmount > 0 && (
                      <div className="flex justify-between items-center mt-1.5">
                        <span className="text-xs font-medium text-status-good-600">{lang === "ar" ? "إكرامية" : "Tip"}</span>
                        <span className="text-xs font-semibold text-status-good-600">{tipAmount} EGP</span>
                      </div>
                    )}
                    <div className="border-t border-sand-200 mt-2 pt-2 flex justify-between items-center">
                      <span className="text-sm font-semibold text-text-primary">{lang === "ar" ? "الإجمالي" : "Total"}</span>
                      <span className="text-lg font-semibold text-text-primary">{invoiceTotal + tipAmount} EGP</span>
                    </div>
                  </div>

                  {/* Payment methods + (conditionally) tip — locked behind
                      a single-tap overlay until the guest explicitly
                      chooses to pay. The default invites them to keep
                      eating. Tip appears only AFTER a non-cash payment
                      method is picked: cash tips happen physically at
                      the cashier, and showing the tip pad before the
                      guest has decided how to pay just adds noise. */}
                  <div className="relative mb-4">
                  <div className={paymentUnlocked ? "" : "blur-sm pointer-events-none select-none"}>
                  <p className="text-[11px] font-bold text-text-muted mb-2.5 uppercase tracking-widest">{t("track.paymentMethod")}</p>
                  <div className={`flex gap-2 ${paymentMethod && paymentMethod !== "CASH" && !cashPending && !cashConfirmed ? "mb-4" : "mb-0"}`}>
                    {([["CASH", t("track.cash"), "💵"], ["CARD", t("track.card"), "💳"], ["INSTAPAY", t("track.instapay"), "📱"]] as [string, string, string][]).map(([key, label, icon]) => {
                      const locked = cashPending || cashConfirmed;
                      const selected = paymentMethod === key;
                      return (
                        <button
                          key={key}
                          onClick={() => {
                            if (locked) return;
                            // Switching to cash zeros any previously-entered
                            // digital tip — there's no UI for it any more
                            // and the receipt summary should reflect that.
                            if (key === "CASH") {
                              setTipAmount(0);
                              setCustomTip("");
                              setShowCustomTip(false);
                            }
                            setPaymentMethod(key as "CASH" | "CARD" | "INSTAPAY");
                          }}
                          disabled={locked}
                          className={`flex-1 py-3.5 rounded-xl text-sm font-bold border-2 transition-all flex flex-col items-center gap-1 ${
                            selected
                              ? "border-ocean-500 bg-ocean-50 text-ocean-700"
                              : "border-sand-200 bg-white text-text-secondary"
                          } ${locked && !selected ? "opacity-40 cursor-not-allowed" : ""} ${locked && selected ? "cursor-not-allowed" : ""}`}
                        >
                          <span className="text-lg">{icon}</span>
                          <span className="text-[11px]">{label}</span>
                        </button>
                      );
                    })}
                  </div>

                  {/* Tip selector — only after a non-cash method is picked
                      and before the guest has actually requested payment.
                      Animated open/close so it doesn't pop in jarringly. */}
                  <AnimatePresence initial={false}>
                  {paymentMethod && paymentMethod !== "CASH" && !cashPending && !cashConfirmed && (
                    <motion.div
                      key="tip-section"
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: "auto" }}
                      exit={{ opacity: 0, height: 0 }}
                      transition={{ duration: 0.18 }}
                      className="overflow-hidden"
                    >
                      <div className="pt-1">
                        <p className="text-[11px] font-bold text-text-muted mb-2 uppercase tracking-widest">{lang === "ar" ? "إكرامية" : "Leave a Tip"}</p>
                        <div className="flex gap-2">
                          {[{ v: 0, l: lang === "ar" ? "لا" : "No tip" }, { v: 20, l: "20" }, { v: 50, l: "50" }, { v: 100, l: "100" }].map(({ v, l }) => {
                            const selected = tipAmount === v && !showCustomTip;
                            return (
                              <button
                                key={v}
                                onClick={() => { setTipAmount(v); setShowCustomTip(false); setCustomTip(""); }}
                                className={`flex-1 py-2 rounded-xl text-xs font-bold border-2 transition-all ${
                                  selected
                                    ? "border-status-good-500 bg-status-good-50 text-status-good-700"
                                    : "border-sand-200 bg-white text-text-secondary"
                                }`}
                              >
                                {v === 0 ? l : `${l} EGP`}
                              </button>
                            );
                          })}
                          <button
                            onClick={() => { setShowCustomTip(!showCustomTip); if (!showCustomTip) setTipAmount(0); }}
                            className={`flex-1 py-2 rounded-xl text-xs font-bold border-2 transition-all ${
                              showCustomTip
                                ? "border-status-good-500 bg-status-good-50 text-status-good-700"
                                : "border-sand-200 bg-white text-text-secondary"
                            }`}
                          >
                            {lang === "ar" ? "آخر" : "Other"}
                          </button>
                        </div>
                        <AnimatePresence>
                          {showCustomTip && (
                            <motion.div
                              className="mt-2 flex gap-2"
                              initial={{ opacity: 0, height: 0 }}
                              animate={{ opacity: 1, height: "auto" }}
                              exit={{ opacity: 0, height: 0 }}
                            >
                              <input
                                type="number"
                                placeholder={lang === "ar" ? "أدخل المبلغ" : "Enter amount"}
                                value={customTip}
                                onChange={(e) => { setCustomTip(e.target.value); setTipAmount(parseInt(e.target.value) || 0); }}
                                className="flex-1 px-3 py-2 rounded-xl border border-sand-200 bg-sand-50 text-sm text-text-secondary focus:outline-none focus:ring-2 focus:ring-status-good-200"
                              />
                              <span className="flex items-center text-xs text-text-muted font-medium">EGP</span>
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </div>
                    </motion.div>
                  )}
                  </AnimatePresence>
                  </div>
                  {!paymentUnlocked && (
                    <button
                      type="button"
                      onClick={() => setPaymentUnlocked(true)}
                      className="absolute inset-0 flex flex-col items-center justify-center gap-3 rounded-2xl bg-white/55 backdrop-blur-[2px] border-2 border-dashed border-sand-300 hover:bg-white/70 active:scale-[0.98] transition"
                    >
                      <div className="w-12 h-12 rounded-full bg-sand-900 text-white flex items-center justify-center text-xl shadow-lg">
                        🔒
                      </div>
                      <div className="text-center px-4">
                        <p className="text-sm font-semibold text-text-primary">
                          {lang === "ar" ? "افتح الدفع الآن" : "Unlock payment now"}
                        </p>
                        <p className="text-[11px] font-semibold text-text-secondary mt-0.5">
                          {lang === "ar" ? "أو استمتع بطعامك وادفع لاحقًا" : "or enjoy your food and pay later"}
                        </p>
                      </div>
                    </button>
                  )}
                  </div>

                  {cashConfirmed ? (
                    <div className="text-center py-4">
                      <motion.div
                        className="w-14 h-14 rounded-full bg-status-good-50 flex items-center justify-center mx-auto mb-3 border-2 border-status-good-200"
                        initial={{ scale: 0.6, opacity: 0 }}
                        animate={{ scale: 1, opacity: 1 }}
                        transition={{ type: "spring", stiffness: 300, damping: 18 }}
                      >
                        <span className="text-2xl">✓</span>
                      </motion.div>
                      <p className="text-sm font-bold text-status-good-700 mb-1">
                        {lang === "ar" ? "تم استلام الدفع" : "Payment received"}
                      </p>
                      <p className="text-xs text-text-muted">
                        {lang === "ar" ? "طعامك في الطريق" : "Your food is on the way"}
                      </p>
                    </div>
                  ) : cashPending ? (
                    <div className="text-center py-4">
                      <motion.div
                        className="w-14 h-14 rounded-full bg-status-warn-50 flex items-center justify-center mx-auto mb-3 border border-status-warn-100"
                        animate={{ scale: [1, 1.05, 1] }}
                        transition={{ repeat: Infinity, duration: 2 }}
                      >
                        <span className="text-2xl">🏪</span>
                      </motion.div>
                      <p className="text-sm font-bold text-text-primary mb-1">
                        {paymentMethod === "CASH"
                          ? (lang === "ar" ? "توجه للكاشير" : "Please head to the cashier")
                          : (lang === "ar" ? "في انتظار تأكيد الكاشير" : "Waiting for cashier confirmation")}
                      </p>
                      <p className="text-xs text-text-muted">
                        {paymentMethod === "CASH"
                          ? (lang === "ar" ? "ادفع فاتورتك عند الكاشير" : "Pay your invoice at the reception")
                          : (lang === "ar" ? "سيقوم الكاشير بتأكيد الدفع قريباً" : "The cashier will confirm your payment shortly")}
                      </p>
                      <button
                        onClick={async () => {
                          if (isPaying) return;
                          setIsPaying(true);
                          try {
                            const res = await fetch("/api/sessions/pay", {
                              method: "DELETE",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({ sessionId }),
                            });
                            if (res.ok) {
                              setCashPending(false);
                              setPaymentMethod(null);
                            }
                          } catch { /* silent */ }
                          setIsPaying(false);
                        }}
                        disabled={isPaying}
                        className="mt-3 text-xs font-bold text-text-secondary underline underline-offset-2 disabled:opacity-50"
                      >
                        {lang === "ar" ? "إلغاء الطلب" : "Cancel request"}
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => {
                        if (!paymentMethod || isPaying) return;
                        setPayError(null);
                        setShowPayConfirm(true);
                      }}
                      disabled={!paymentMethod || isPaying}
                      className={`w-full py-3.5 rounded-2xl font-bold text-[15px] transition-all ${
                        paymentMethod && !isPaying
                          ? "bg-ocean-600 hover:bg-ocean-700 text-white shadow-lg shadow-ocean-500/20"
                          : "bg-sand-200 text-text-muted cursor-not-allowed"
                      }`}
                    >
                      {isPaying ? t("track.processing") : paymentMethod === "CASH"
                        ? `${lang === "ar" ? "ادفع عند الكاشير" : "Pay at Cashier"} — ${invoiceTotal + tipAmount} ${t("common.egp")}`
                        : `${t("track.pay")} ${invoiceTotal + tipAmount} ${t("common.egp")}`}
                    </button>
                  )}
                </div>
              </div>
            ) : sessionId && !isSessionOwner && !hasPaymentAuthority ? (
              <div className="mt-4 bg-sand-50 rounded-2xl p-5 border border-sand-100 text-center">
                <p className="text-sm font-semibold text-text-secondary mb-1">
                  {lang === "ar" ? "الدفع من صلاحية صاحب الطاولة" : "Payment is handled by the table host"}
                </p>
                <p className="text-xs text-text-muted">
                  {lang === "ar" ? "يمكن لصاحب الجلسة تفويضك للدفع" : "The session owner can delegate payment to you"}
                </p>
              </div>
            ) : null}
          </div>
        )}
      </div>

      <AnimatePresence>
        {showPayConfirm && (
          <motion.div
            className="absolute inset-0 z-50 flex items-end justify-center bg-sand-900/40 backdrop-blur-sm"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => { if (!isPaying) setShowPayConfirm(false); }}
          >
            <motion.div
              className="w-full bg-white rounded-t-3xl p-6 shadow-2xl"
              initial={{ y: 400 }}
              animate={{ y: 0 }}
              exit={{ y: 400 }}
              transition={{ type: "spring", stiffness: 260, damping: 26 }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="w-12 h-1 bg-sand-200 rounded-full mx-auto mb-4" />
              <div className="text-center mb-5">
                <div className="w-14 h-14 rounded-full bg-ocean-50 flex items-center justify-center mx-auto mb-3 border border-ocean-100">
                  <span className="text-2xl">🔒</span>
                </div>
                <p className="text-base font-semibold text-text-primary mb-2">
                  {lang === "ar" ? "تأكيد الدفع؟" : "Confirm payment?"}
                </p>
                <p className="text-xs text-text-secondary leading-relaxed px-2">
                  {lang === "ar"
                    ? "سنُعلم الكاشير بطريقة الدفع التي اخترتها. تبقى طاولتك مفتوحة حتى يؤكد الكاشير ويتم تقديم أي طلبات متبقية — بعدها تُغلق الجلسة، وللطلب مجدداً امسح رمز QR."
                    : "We'll let the cashier know your payment method. Your table stays open until they confirm and any remaining orders are served — after that the session closes, and you'll rescan the QR to order again."}
                </p>
              </div>
              {payError && (
                <div className="mb-3 rounded-xl border border-status-bad-200 bg-status-bad-50 px-3 py-2 text-center">
                  <p className="text-xs font-bold text-status-bad-700">{payError}</p>
                </div>
              )}
              <div className="flex gap-2">
                <button
                  onClick={() => { if (!isPaying) { setShowPayConfirm(false); setPayError(null); } }}
                  disabled={isPaying}
                  className="flex-1 py-3.5 rounded-2xl font-bold text-[14px] bg-sand-100 text-text-secondary disabled:opacity-50"
                >
                  {lang === "ar" ? "لاحقاً" : "Later"}
                </button>
                <button
                  onClick={async () => {
                    if (!paymentMethod || isPaying) return;
                    setIsPaying(true);
                    setPayError(null);
                    let ok = false;
                    try {
                      const payCtrl = new AbortController();
                      const payTimeout = setTimeout(() => payCtrl.abort(), 30_000);
                      const res = await fetch("/api/sessions/pay", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ sessionId, paymentMethod, tip: tipAmount }),
                        signal: payCtrl.signal,
                      });
                      clearTimeout(payTimeout);
                      if (res.ok) {
                        const data = await res.json();
                        if (data.pending) {
                          setCashPending(true);
                        } else {
                          setIsPaid(true);
                        }
                        ok = true;
                      }
                    } catch { /* handled below */ }
                    setIsPaying(false);
                    if (ok) {
                      setShowPayConfirm(false);
                    } else {
                      setPayError(
                        lang === "ar"
                          ? "تعذر إرسال الطلب. حاول مرة أخرى."
                          : "Couldn't submit — please try again."
                      );
                    }
                  }}
                  disabled={isPaying}
                  className="flex-1 py-3.5 rounded-2xl font-bold text-[14px] text-white shadow-lg shadow-ocean-500/20 disabled:opacity-60 bg-ocean-600 hover:bg-ocean-700 transition-colors"
                >
                  {isPaying ? t("track.processing") : (lang === "ar" ? "تأكيد الدفع" : "Confirm payment")}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </PhoneFrame>
  );
}
