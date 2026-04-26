"use client";

import { useEffect, useState, useCallback, useRef, Suspense } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { startPoll } from "@/lib/polling";
import Link from "next/link";

type OrderItem = { name: string; quantity: number; price: number };
type TrackedOrder = {
  id: string;
  orderNumber: number;
  status: string;
  total: number;
  // Delivery fee bundled into total (server-side). 0 for non-delivery
  // orders. Older orders that predate the column read as 0, which is
  // fine — the UI just shows no fee line.
  deliveryFee: number;
  paymentMethod: string | null;
  paidAt: string | null;
  items: OrderItem[];
  createdAt: string;
};

type DeliveryInfo = {
  deliveryStatus: string | null;
  deliveryDriverName: string | null;
  pickedUpAt: string | null;
  deliveredAt: string | null;
};

const DINE_IN_STEPS = [
  { key: "confirmed", label: "Confirmed", icon: "check" },
  { key: "preparing", label: "Preparing", icon: "fire" },
  { key: "ready", label: "Ready", icon: "sparkle" },
  { key: "served", label: "Served", icon: "done" },
];

const DELIVERY_KITCHEN_STEPS = [
  { key: "confirmed", label: "Confirmed", icon: "check" },
  { key: "preparing", label: "Preparing", icon: "fire" },
  { key: "ready", label: "Ready", icon: "sparkle" },
];

const DELIVERY_DRIVER_STEPS = [
  { key: "ASSIGNED", label: "Assigned", icon: "box" },
  { key: "PICKED_UP", label: "Picked Up", icon: "bike" },
  { key: "ON_THE_WAY", label: "On The Way", icon: "rocket" },
  { key: "DELIVERED", label: "Delivered", icon: "home" },
];

const STATUS_RANK: Record<string, number> = {
  PENDING: 0, CONFIRMED: 1, PREPARING: 2, READY: 3, SERVED: 4, PAID: 5,
};

function StepIcon({ icon, active, done }: { icon: string; active: boolean; done: boolean }) {
  const color = done ? "text-white" : active ? "text-white" : "text-sand-300";
  const cls = `w-5 h-5 ${color}`;
  if (icon === "check") return <svg className={cls} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>;
  if (icon === "fire") return <svg className={cls} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M15.362 5.214A8.252 8.252 0 0112 21 8.25 8.25 0 016.038 7.048 8.287 8.287 0 009 9.6a8.983 8.983 0 013.361-6.867 8.21 8.21 0 003 2.48z" /></svg>;
  if (icon === "sparkle") return <svg className={cls} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" /></svg>;
  if (icon === "done") return <svg className={cls} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" /></svg>;
  if (icon === "box") return <span className={`text-sm ${color}`}>&#x1F4E6;</span>;
  if (icon === "bike") return <span className={`text-sm ${color}`}>&#x1F6F5;</span>;
  if (icon === "rocket") return <span className={`text-sm ${color}`}>&#x1F680;</span>;
  if (icon === "home") return <span className={`text-sm ${color}`}>&#x1F3E0;</span>;
  return <svg className={cls} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>;
}

function getStepIndex(status: string, steps: { key: string }[]) {
  const idx = steps.findIndex((s) => s.key === status.toLowerCase());
  return idx >= 0 ? idx : -1;
}

function StepProgress({ steps, currentIndex }: { steps: { key: string; label: string; icon: string }[]; currentIndex: number }) {
  return (
    <div className="flex items-center justify-between relative">
      <div className="absolute top-5 left-[calc(12.5%)] right-[calc(12.5%)] h-0.5 bg-sand-100 z-0" />
      <motion.div
        className="absolute top-5 left-[calc(12.5%)] h-0.5 bg-gradient-to-r from-ocean-500 to-status-good-500 z-0"
        initial={false}
        animate={{
          width: currentIndex < 0 ? "0%" :
            `${Math.min(100, (currentIndex / (steps.length - 1)) * 100) * 0.75}%`
        }}
        transition={{ duration: 0.8, ease: "easeOut" }}
      />
      {steps.map((step, i) => {
        const isComplete = currentIndex >= i;
        const isActive = currentIndex === i;
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
                <span className="text-[11px] font-bold text-sand-300">{i + 1}</span>
              )}
            </motion.div>
            <p className={`text-[10px] font-semibold mt-2 text-center transition-colors ${
              isComplete ? "text-text-primary" : "text-sand-300"
            }`}>
              {step.label}
            </p>
          </div>
        );
      })}
    </div>
  );
}

function formatEGP(n: number) {
  return Math.round(n).toLocaleString("en-EG");
}

const DELIVERY_RANK: Record<string, number> = { ASSIGNED: 1, PICKED_UP: 2, ON_THE_WAY: 3, DELIVERED: 4 };
function deliveryRank(status: string | null): number {
  return status ? (DELIVERY_RANK[status] ?? 0) : 0;
}

function VipTrackContent() {
  const { token } = useParams<{ token: string }>();
  const searchParams = useSearchParams();
  const sessionId = searchParams.get("sessionId") || "";
  const orderType = searchParams.get("orderType") || "VIP_DINE_IN";
  const restaurantId = searchParams.get("slug") || "";
  const vipName = searchParams.get("vipName") || "VIP";

  const [orders, setOrders] = useState<TrackedOrder[]>([]);
  const [deliveryInfo, setDeliveryInfo] = useState<DeliveryInfo | null>(null);
  const [sessionStatus, setSessionStatus] = useState("OPEN");
  const [loading, setLoading] = useState(true);
  const [paymentMethod, setPaymentMethod] = useState<string | null>(null);
  const [paymentSent, setPaymentSent] = useState(false);
  const [paymentSending, setPaymentSending] = useState(false);
  const [paymentError, setPaymentError] = useState(false);
  const finalRef = useRef(false);
  const [consecutivePollErrors, setConsecutivePollErrors] = useState(0);
  const consecutivePollErrorsRef = useRef(0);

  const isDelivery = orderType === "DELIVERY";

  const vipGuestId = searchParams.get("vipGuestId") || (typeof window !== "undefined" ? localStorage.getItem("ttc_vip_guestId") : "") || "";
  const menuUrl = `/menu?slug=${restaurantId}&sessionId=${sessionId}&vip=1&vipGuestId=${vipGuestId}&vipName=${encodeURIComponent(vipName)}&orderType=${orderType}`;

  const poll = useCallback(async () => {
    if (!sessionId || finalRef.current) return;

    try {
      const res = await fetch(`/api/guest-poll?sessionId=${sessionId}&restaurantId=${restaurantId}`);
      if (!res.ok) {
        consecutivePollErrorsRef.current += 1;
        setConsecutivePollErrors(consecutivePollErrorsRef.current);
        return;
      }
      // Successful response — reset error counter
      consecutivePollErrorsRef.current = 0;
      setConsecutivePollErrors(0);
      const data = await res.json();

      if (data.session) {
        setSessionStatus(data.session.status);
      }
      if (data.orders) {
        setOrders(data.orders);
        const live = (data.orders as TrackedOrder[]).filter((o) => o.status !== "CANCELLED");
        const allPaid = live.length > 0 && live.every((o) => o.paidAt);
        const pending = live.find((o) => o.paymentMethod && !o.paidAt);
        if (allPaid) {
          setPaymentSent(true);
          setPaymentMethod(live[0]?.paymentMethod || null);
          if (!isDelivery) finalRef.current = true;
        } else if (pending) {
          setPaymentSent(true);
          setPaymentMethod(pending.paymentMethod);
        }
      }

      if (isDelivery && data.orders?.length > 0) {
        const liveOrders = (data.orders as TrackedOrder[]).filter((o) => o.status !== "CANCELLED");
        let worstStatus: DeliveryInfo | null = null;
        for (const ord of liveOrders) {
          try {
            const delRes = await fetch(`/api/delivery?restaurantId=${restaurantId}&orderId=${ord.id}`);
            if (!delRes.ok) continue;
            const deliveries = await delRes.json();
            if (!deliveries[0]) continue;
            const info: DeliveryInfo = {
              deliveryStatus: deliveries[0].deliveryStatus,
              deliveryDriverName: deliveries[0].deliveryDriverName,
              pickedUpAt: deliveries[0].pickedUpAt,
              deliveredAt: deliveries[0].deliveredAt,
            };
            if (!worstStatus || deliveryRank(info.deliveryStatus) < deliveryRank(worstStatus.deliveryStatus)) {
              worstStatus = info;
            }
          } catch {}
        }
        if (worstStatus) {
          setDeliveryInfo(worstStatus);
          if (worstStatus.deliveryStatus === "DELIVERED") finalRef.current = true;
        }
      }
    } catch {
      consecutivePollErrorsRef.current += 1;
      setConsecutivePollErrors(consecutivePollErrorsRef.current);
    }

    setLoading(false);
  }, [sessionId, restaurantId, isDelivery]);

  useEffect(() => {
    if (!sessionId) {
      setLoading(false);
      return;
    }
    const stop = startPoll(poll, 10_000);
    return stop;
  }, [poll, sessionId]);

  const handlePay = async (method: string) => {
    setPaymentSending(true);
    setPaymentError(false);
    try {
      const payCtrl = new AbortController();
      const payTimeout = setTimeout(() => payCtrl.abort(), 30_000);
      const res = await fetch("/api/sessions/pay", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, paymentMethod: method }),
        signal: payCtrl.signal,
      });
      clearTimeout(payTimeout);
      if (res.ok) {
        setPaymentMethod(method);
        setPaymentSent(true);
      } else {
        setPaymentError(true);
      }
    } catch {
      setPaymentError(true);
    } finally {
      setPaymentSending(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-dvh bg-gradient-to-b from-sand-50 to-white flex items-center justify-center">
        <motion.div
          className="w-10 h-10 border-3 border-ocean-400 border-t-transparent rounded-full"
          animate={{ rotate: 360 }}
          transition={{ repeat: Infinity, duration: 1, ease: "linear" }}
        />
      </div>
    );
  }

  if (!sessionId) {
    return (
      <div className="min-h-dvh bg-gradient-to-b from-sand-50 to-white flex items-center justify-center px-8">
        <div className="text-center">
          <h2 className="text-lg font-bold text-text-primary mb-2">No active session</h2>
          <p className="text-text-muted text-sm mb-6">Start a new order from your VIP link</p>
          <a href={`/vip/${token}`} className="px-8 py-3.5 rounded-2xl font-bold text-[15px] text-white inline-block bg-ocean-600 hover:bg-ocean-700 transition-colors">
            Go to VIP Home
          </a>
        </div>
      </div>
    );
  }

  const activeOrders = orders.filter((o) => o.status !== "CANCELLED");
  const unpaidOrders = activeOrders.filter((o) => !o.paidAt);
  const latestOrder = activeOrders[0];
  const orderStatus = latestOrder?.status?.toUpperCase() || "PENDING";
  const allPaid = activeOrders.length > 0 && activeOrders.every((o) => o.paidAt);
  const isServed = orderStatus === "SERVED" || orderStatus === "PAID";
  const isDelivered = deliveryInfo?.deliveryStatus === "DELIVERED";
  // Order.total now includes the delivery fee server-side. The fee
  // breakdown lines below read order.deliveryFee directly, summed
  // across orders so multi-round invoices stay correct.
  const invoiceTotal = unpaidOrders.reduce((s, o) => s + o.total, 0);
  const invoiceFee = unpaidOrders.reduce((s, o) => s + (o.deliveryFee || 0), 0);
  const displayTotal = invoiceTotal;

  const kitchenSteps = isDelivery ? DELIVERY_KITCHEN_STEPS : DINE_IN_STEPS;
  const kitchenIndex = getStepIndex(orderStatus === "PAID" ? "served" : orderStatus, kitchenSteps);

  const isFinalState = isDelivery ? isDelivered : (allPaid || orderStatus === "PAID");

  return (
    <div className="min-h-dvh bg-gradient-to-b from-sand-50 to-white">
      <div className="max-w-[430px] mx-auto lg:rounded-3xl lg:overflow-hidden lg:h-[min(900px,90dvh)] lg:shadow-2xl lg:ring-1 lg:ring-white/10 h-dvh flex flex-col">
        {/* Header */}
        <div className="bg-white/80 backdrop-blur-xl sticky top-0 z-20 px-5 py-4 border-b border-sand-100/50 safe-top">
          <div className="flex items-center gap-3">
            <Link
              href={menuUrl}
              className="w-10 h-10 rounded-full bg-sand-100 flex items-center justify-center text-text-muted active:scale-95 transition"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18" />
              </svg>
            </Link>
            <div className="flex-1">
              <h1 className="text-lg font-semibold text-text-primary tracking-tight">Track Order</h1>
              <p className="text-[11px] text-text-muted font-medium flex items-center gap-1.5">
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-status-wait-50 border border-status-wait-200 text-status-wait-700 text-[10px] font-bold">{"\u{1F451}"} VIP</span>
                {decodeURIComponent(vipName)}
                {activeOrders.length > 0 && <span className="text-text-muted">·</span>}
                {activeOrders.length > 0 && <span>{activeOrders.length} order{activeOrders.length > 1 ? "s" : ""}</span>}
              </p>
            </div>
            <span className="text-[10px] font-bold px-2.5 py-1 rounded-full bg-sand-100 text-text-secondary uppercase">
              {isDelivery ? "Delivery" : "Dine-In"}
            </span>
          </div>
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
              <p className="text-xs font-bold text-status-warn-700">Connection lost — retrying...</p>
            </motion.div>
          )}
        </AnimatePresence>

        <div className="flex-1 overflow-y-auto px-5 pt-6 pb-8">
          {/* Session closed with no orders */}
          {sessionStatus === "CLOSED" && !latestOrder && (
            <div className="flex flex-col items-center justify-center text-center pt-20">
              <motion.div
                className="w-20 h-20 rounded-full bg-status-good-100 flex items-center justify-center mb-5"
                initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: "spring", damping: 12 }}
              >
                <svg className="w-10 h-10 text-status-good-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </motion.div>
              <h2 className="text-xl font-bold text-text-primary mb-2">Session Ended</h2>
              <p className="text-text-muted text-sm mb-6">Thanks for visiting!</p>
              <a href={`/vip/${token}`} className="px-8 py-3.5 rounded-2xl font-bold text-[15px] text-white bg-ocean-600 hover:bg-ocean-700 transition-colors">
                Start New Order
              </a>
            </div>
          )}

          {/* No orders yet */}
          {!latestOrder && sessionStatus === "OPEN" && (
            <div className="flex flex-col items-center justify-center text-center pt-20">
              <motion.div
                className="w-20 h-20 rounded-full bg-sand-100 flex items-center justify-center mb-5"
                animate={{ scale: [1, 1.05, 1] }}
                transition={{ repeat: Infinity, duration: 3 }}
              >
                <svg className="w-8 h-8 text-text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </motion.div>
              <h2 className="text-lg font-bold text-text-primary mb-2">No orders yet</h2>
              <p className="text-text-muted text-sm mb-6 max-w-xs">Browse the menu and add something delicious</p>
              <Link href={menuUrl} className="px-8 py-3.5 rounded-2xl font-bold text-[15px] text-white bg-ocean-600 hover:bg-ocean-700 transition-colors">
                Browse Menu
              </Link>
            </div>
          )}

          {latestOrder && (
            <div className="space-y-5">
              {/* Status hero */}
              {!isFinalState && (
                <motion.div
                  className="bg-white rounded-3xl p-6 shadow-sm border border-sand-100 text-center relative overflow-hidden"
                  initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
                >
                  {kitchenIndex >= 0 && kitchenIndex < kitchenSteps.length - 1 && (
                    <motion.div
                      className="absolute inset-0 rounded-3xl"
                      style={{
                        background: kitchenIndex === 1
                          ? "radial-gradient(circle at center, rgba(251,146,60,0.06) 0%, transparent 70%)"
                          : "radial-gradient(circle at center, rgba(99,102,241,0.06) 0%, transparent 70%)"
                      }}
                      animate={{ scale: [1, 1.2, 1], opacity: [0.5, 1, 0.5] }}
                      transition={{ repeat: Infinity, duration: 3 }}
                    />
                  )}
                  <motion.div
                    className={`w-16 h-16 rounded-full mx-auto mb-4 flex items-center justify-center ${
                      kitchenIndex === -1 ? "bg-sand-100" :
                      kitchenIndex === 0 ? "bg-ocean-100" :
                      kitchenIndex === 1 ? "bg-status-warn-100" :
                      "bg-status-good-100"
                    }`}
                    key={kitchenIndex}
                    initial={{ scale: 0.5, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
                    transition={{ type: "spring", damping: 12 }}
                  >
                    {kitchenIndex === -1 ? (
                      <motion.div className="w-5 h-5 border-2 border-sand-300 border-t-sand-500 rounded-full" animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 1, ease: "linear" }} />
                    ) : (
                      <StepIcon icon={kitchenSteps[Math.min(kitchenIndex, kitchenSteps.length - 1)].icon} active={true} done={false} />
                    )}
                  </motion.div>
                  <h2 className="text-xl font-semibold text-text-primary mb-1 tracking-tight relative">
                    {kitchenIndex >= 0 ? kitchenSteps[Math.min(kitchenIndex, kitchenSteps.length - 1)].label : "Waiting for confirmation"}
                  </h2>
                  <p className="text-sm text-text-muted font-light relative">
                    {kitchenIndex === -1 && "Your order is being reviewed"}
                    {kitchenIndex === 0 && "Your order has been confirmed"}
                    {kitchenIndex === 1 && "The kitchen is preparing your food"}
                    {kitchenIndex === 2 && (isDelivery ? "Your order is ready for pickup" : "Your order is ready to be served")}
                    {kitchenIndex === 3 && "Enjoy your meal!"}
                  </p>
                </motion.div>
              )}

              {/* Final state hero */}
              {isFinalState && (
                <motion.div
                  className="bg-white rounded-3xl p-6 shadow-sm border border-status-good-100 text-center"
                  initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
                >
                  <motion.div
                    className="w-20 h-20 rounded-full bg-status-good-100 mx-auto mb-4 flex items-center justify-center"
                    initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: "spring", damping: 12 }}
                  >
                    <svg className="w-10 h-10 text-status-good-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                    </svg>
                  </motion.div>
                  <h2 className="text-xl font-semibold text-text-primary mb-1">
                    {isDelivery ? "Delivered!" : "All Done!"}
                  </h2>
                  <p className="text-sm text-text-muted font-light">
                    {isDelivery ? "Your order has been delivered. Enjoy!" : "Thank you for dining with us!"}
                  </p>
                </motion.div>
              )}

              {/* Kitchen progress steps */}
              {!isFinalState && (
                <div className="bg-white rounded-2xl p-5 shadow-sm border border-sand-100">
                  <StepProgress steps={kitchenSteps} currentIndex={kitchenIndex} />
                </div>
              )}

              {/* Delivery progress steps */}
              {isDelivery && (STATUS_RANK[orderStatus] ?? 0) >= STATUS_RANK.READY && !isFinalState && (
                <div className="bg-white rounded-2xl p-5 shadow-sm border border-status-warn-100">
                  <div className="flex items-center gap-2 mb-4">
                    <span className="text-xs font-bold text-status-warn-700 uppercase tracking-wider">Delivery</span>
                    {deliveryInfo?.deliveryDriverName && (
                      <span className="text-xs text-text-secondary">· {deliveryInfo.deliveryDriverName}</span>
                    )}
                  </div>
                  {deliveryInfo?.deliveryStatus ? (
                    <StepProgress
                      steps={DELIVERY_DRIVER_STEPS}
                      currentIndex={DELIVERY_DRIVER_STEPS.findIndex((s) => s.key === deliveryInfo.deliveryStatus)}
                    />
                  ) : (
                    <div className="flex items-center justify-center gap-2 py-3 text-sm text-status-warn-600">
                      <motion.div className="w-4 h-4 border-2 border-status-warn-400 border-t-transparent rounded-full" animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 1, ease: "linear" }} />
                      Waiting for driver assignment...
                    </div>
                  )}
                  {deliveryInfo?.deliveryStatus === "ON_THE_WAY" && (
                    <motion.p className="text-sm text-status-warn-700 font-bold mt-3 text-center" animate={{ opacity: [1, 0.5, 1] }} transition={{ repeat: Infinity, duration: 2 }}>
                      Your order is on its way!
                    </motion.p>
                  )}
                </div>
              )}

              {/* Order cards */}
              <AnimatePresence>
                {activeOrders.map((ord) => (
                  <motion.div
                    key={ord.id}
                    className="bg-white rounded-2xl p-5 shadow-sm border border-sand-100"
                    initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                  >
                    <div className="flex items-center justify-between mb-3">
                      <span className="text-xs font-bold text-text-muted uppercase tracking-wider">Order #{ord.orderNumber}</span>
                      {ord.paidAt ? (
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-status-good-100 text-status-good-700">PAID</span>
                      ) : (
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full uppercase ${
                          ord.status === "SERVED" ? "bg-status-good-50 text-status-good-600" :
                          ord.status === "READY" ? "bg-status-warn-50 text-status-warn-600" :
                          ord.status === "PREPARING" ? "bg-status-warn-50 text-status-warn-600" :
                          "bg-sand-50 text-text-secondary"
                        }`}>{ord.status}</span>
                      )}
                    </div>
                    <div className="space-y-1.5">
                      {ord.items.map((item, i) => (
                        <div key={i} className="flex items-center justify-between text-sm">
                          <span className="text-text-secondary">
                            <span className="font-semibold text-text-primary">{item.quantity}x</span> {item.name}
                          </span>
                          <span className="text-text-muted font-bold tabular-nums">{formatEGP(item.price * item.quantity)} EGP</span>
                        </div>
                      ))}
                    </div>
                    <div className="border-t border-sand-100 pt-3 mt-3 flex justify-between items-center">
                      <span className="font-bold text-text-primary text-sm">Subtotal</span>
                      <span className="font-semibold text-text-primary">{formatEGP(ord.total)} EGP</span>
                    </div>
                  </motion.div>
                ))}
              </AnimatePresence>

              {/* Delivery fee + grand total — Order.total already
                  includes the fee, so the "subtotal" line is total
                  minus fee and the "total" line is just total. */}
              {isDelivery && activeOrders.length > 0 && (() => {
                const total = activeOrders.reduce((s, o) => s + o.total, 0);
                const fee = activeOrders.reduce((s, o) => s + (o.deliveryFee || 0), 0);
                return (
                  <div className="bg-white rounded-2xl p-5 shadow-sm border border-status-warn-100">
                    <div className="flex justify-between text-sm mb-2">
                      <span className="text-text-secondary">Order subtotal</span>
                      <span className="text-text-primary font-bold tabular-nums">{formatEGP(total - fee)} EGP</span>
                    </div>
                    <div className="flex justify-between text-sm mb-3">
                      <span className="text-text-secondary">Delivery fee</span>
                      <span className="text-text-primary font-bold tabular-nums">{formatEGP(fee)} EGP</span>
                    </div>
                    <div className="border-t border-sand-100 pt-3 flex justify-between">
                      <span className="font-semibold text-text-primary">Total</span>
                      <span className="font-semibold text-text-primary text-lg">{formatEGP(total)} EGP</span>
                    </div>
                  </div>
                );
              })()}

              {/* Payment error banner */}
              {paymentError && (
                <motion.div
                  className="bg-status-warn-50 rounded-xl p-4 border border-status-warn-200 flex items-center justify-between gap-3"
                  initial={{ opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }}
                >
                  <p className="text-xs font-bold text-status-warn-700">Payment failed — please try again</p>
                  <button
                    onClick={() => setPaymentError(false)}
                    className="text-xs font-bold text-status-warn-600 underline underline-offset-2 flex-shrink-0"
                  >
                    Dismiss
                  </button>
                </motion.div>
              )}

              {/* Payment section — only for dine-in (delivery pre-selects at checkout) */}
              {!isDelivery && isServed && !allPaid && !paymentSent && (
                <motion.div
                  className="bg-white rounded-2xl p-5 shadow-sm border border-sand-100"
                  initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
                >
                  <h3 className="text-xs font-bold text-text-muted uppercase tracking-wider mb-4">Choose Payment Method</h3>
                  {displayTotal > 0 && (
                    <p className="text-sm text-text-secondary mb-4">Amount due: <strong className="text-text-primary">{formatEGP(displayTotal)} EGP</strong>{isDelivery && invoiceFee > 0 && <span className="text-xs text-text-muted ml-1">(incl. {invoiceFee} EGP delivery)</span>}</p>
                  )}
                  <div className="grid grid-cols-3 gap-2">
                    {[
                      { key: "CASH", label: "Cash", emoji: "\uD83D\uDCB5" },
                      { key: "CARD", label: "Card", emoji: "\uD83D\uDCB3" },
                      { key: "INSTAPAY", label: "InstaPay", emoji: "\u26A1" },
                    ].map((m) => (
                      <button
                        key={m.key}
                        onClick={() => handlePay(m.key)}
                        disabled={paymentSending}
                        className="flex flex-col items-center gap-1.5 py-4 rounded-xl border-2 border-sand-200 hover:border-ocean-400 transition active:scale-95 disabled:opacity-50"
                      >
                        <span className="text-2xl">{m.emoji}</span>
                        <span className="text-xs font-bold text-text-secondary">{m.label}</span>
                      </button>
                    ))}
                  </div>
                </motion.div>
              )}

              {/* Payment pending */}
              {paymentSent && !allPaid && (
                <motion.div
                  className="bg-status-warn-50 rounded-2xl p-5 border-2 border-status-warn-200"
                  initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                >
                  <div className="flex items-center gap-3">
                    <motion.div
                      className="w-8 h-8 border-3 border-status-warn-400 border-t-transparent rounded-full"
                      animate={{ rotate: 360 }}
                      transition={{ repeat: Infinity, duration: 1, ease: "linear" }}
                    />
                    <div>
                      <p className="text-sm font-bold text-status-warn-800">Payment request sent</p>
                      <p className="text-xs text-status-warn-600">
                        {paymentMethod === "CASH" ? "Have cash ready — cashier will confirm" :
                         paymentMethod === "INSTAPAY" ? "InstaPay transfer pending confirmation" :
                         "Card payment pending cashier confirmation"}
                      </p>
                    </div>
                  </div>
                </motion.div>
              )}

              {/* Payment confirmed */}
              {allPaid && (
                <motion.div
                  className="bg-status-good-50 rounded-2xl p-5 border-2 border-status-good-200"
                  initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}
                >
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-status-good-100 flex items-center justify-center">
                      <svg className="w-5 h-5 text-status-good-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                      </svg>
                    </div>
                    <div>
                      <p className="text-sm font-bold text-status-good-800">Payment confirmed</p>
                      <p className="text-xs text-status-good-600">
                        Total: {formatEGP(activeOrders.reduce((s, o) => s + o.total, 0))} EGP
                        {paymentMethod && <span className="ml-1.5 px-1.5 py-0.5 rounded bg-status-good-200 text-status-good-800 text-[10px] font-bold">{paymentMethod}</span>}
                      </p>
                    </div>
                  </div>
                </motion.div>
              )}

              {/* Action buttons */}
              <div className="space-y-3 pt-2">
                {/* Order more */}
                {sessionStatus === "OPEN" && !allPaid && (
                  <Link
                    href={menuUrl}
                    className="block w-full py-3.5 rounded-2xl border-2 border-sand-200 text-text-secondary font-bold text-center text-sm active:scale-[0.98] transition"
                  >
                    + Order More
                  </Link>
                )}

                {/* Download receipt */}
                {(allPaid || isFinalState) && activeOrders.length > 0 && (
                  <button
                    onClick={() => {
                      const grandTotal = activeOrders.reduce((s, o) => s + o.total, 0);
                      const totalFee = activeOrders.reduce((s, o) => s + (o.deliveryFee || 0), 0);
                      const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>VIP Receipt</title>
<style>body{font-family:system-ui,sans-serif;max-width:350px;margin:20px auto;padding:20px;font-size:13px}
h1{font-size:16px;text-align:center;margin-bottom:4px}
.sub{text-align:center;color:#888;font-size:11px;margin-bottom:16px}
.line{display:flex;justify-content:space-between;padding:3px 0}
.sep{border-top:1px dashed #ccc;margin:8px 0}
.bold{font-weight:700}
.badge{display:inline-block;padding:2px 8px;border-radius:8px;font-size:10px;font-weight:700;background:#e8f5e9;color:#2e7d32}
</style></head><body>
<h1>VIP Receipt</h1>
<p class="sub">${decodeURIComponent(vipName)} — ${isDelivery ? "Delivery" : "Dine-In"}</p>
<div class="sep"></div>
${activeOrders.flatMap((o) => o.items.map((i) => `<div class="line"><span>${i.quantity}x ${i.name}</span><span>${formatEGP(i.price * i.quantity)} EGP</span></div>`)).join("")}
<div class="sep"></div>
<div class="line"><span>Subtotal</span><span>${formatEGP(grandTotal - totalFee)} EGP</span></div>
${isDelivery && totalFee > 0 ? `<div class="line"><span>Delivery fee</span><span>${formatEGP(totalFee)} EGP</span></div>` : ""}
<div class="sep"></div>
<div class="line bold"><span>Total</span><span>${formatEGP(grandTotal)} EGP</span></div>
${paymentMethod ? `<div class="line"><span>Payment</span><span class="badge">${paymentMethod}</span></div>` : ""}
<p class="sub" style="margin-top:16px">${new Date().toLocaleString("en-EG")}</p>
</body></html>`;
                      const blob = new Blob([html], { type: "text/html" });
                      const url = URL.createObjectURL(blob);
                      const a = document.createElement("a");
                      a.href = url;
                      a.download = `receipt-vip-${activeOrders[0]?.orderNumber || "order"}.html`;
                      a.click();
                      URL.revokeObjectURL(url);
                    }}
                    className="block w-full py-3 rounded-2xl border-2 border-sand-200 text-text-secondary font-bold text-center text-sm active:scale-[0.98] transition"
                  >
                    Download Receipt
                  </button>
                )}

                {/* Place another order (after completion) */}
                {isFinalState && (
                  <a
                    href={`/vip/${token}`}
                    className="block w-full py-4 rounded-2xl font-bold text-center text-[15px] text-white shadow-lg active:scale-[0.98] transition bg-ocean-600 hover:bg-ocean-700 transition-colors"
                  >
                    Place Another Order
                  </a>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function VipTrackPage() {
  return (
    <Suspense fallback={
      <div className="min-h-dvh bg-gradient-to-b from-sand-50 to-white flex items-center justify-center">
        <div className="w-8 h-8 border-3 border-ocean-400 border-t-transparent rounded-full animate-spin" />
      </div>
    }>
      <VipTrackContent />
    </Suspense>
  );
}
