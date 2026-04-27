"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { canLoginNow } from "@/lib/shifts";
import { startPoll } from "@/lib/polling";
import { useRouter } from "next/navigation";
import { staffFetch } from "@/lib/staff-fetch";
import { useLanguage } from "@/lib/use-language";
import { LanguageToggle } from "@/presentation/components/ui/LanguageToggle";

const RESTAURANT_SLUG = process.env.NEXT_PUBLIC_RESTAURANT_SLUG || "neom-dahab";
const STORAGE_KEY = "delivery_staff";

// Delivery fee comes from the order row itself now (Order.deliveryFee).
// No more local magic number — receipts and the cashier ledger always
// agree on the same value.

type DeliveryOrder = {
  id: string;
  orderNumber: number;
  status: string;
  total: number;
  deliveryFee: number;
  notes: string | null;
  deliveryAddress: string | null;
  deliveryNotes: string | null;
  deliveryLat: number | null;
  deliveryLng: number | null;
  deliveryStatus: string | null;
  deliveryDriverId: string | null;
  deliveryDriverName: string | null;
  vipGuestName: string | null;
  vipGuestPhone: string | null;
  pickedUpAt: string | null;
  deliveredAt: string | null;
  readyAt: string | null;
  paymentMethod: string | null;
  items: { name: string; quantity: number; price: number }[];
  createdAt: string;
};

type Staff = {
  id: string;
  name: string;
  pin: string;
  role: string;
  shift: number;
  active?: boolean;
};

function LoginScreen({ onLogin }: { onLogin: (staff: Staff) => void }) {
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const { t } = useLanguage();

  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed.id && Date.now() - parsed.ts < 16 * 60 * 60 * 1000) {
          onLogin(parsed);
        }
      }
    } catch {}
  }, [onLogin]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");

    try {
      const res = await fetch("/api/staff/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin, restaurantId: RESTAURANT_SLUG }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || t("delivery.invalidPin"));
        setPin("");
        setLoading(false);
        return;
      }

      const match = await res.json();
      if (match.role !== "DELIVERY" && match.role !== "OWNER") {
        setError(t("delivery.invalidPin"));
        setPin("");
        setLoading(false);
        return;
      }

      // Sync schedule after login so we have a valid staffId for auth
      staffFetch(match.id, "/api/schedule/sync", {
        method: "POST",
        body: JSON.stringify({ restaurantId: RESTAURANT_SLUG }),
      }).catch(() => {});

      onLogin(match);
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...match, ts: Date.now() }));
    } catch {
      setError(t("delivery.loginFailed"));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-dvh bg-beach flex items-center justify-center p-6">
      <form onSubmit={handleSubmit} className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-status-warn-400 to-status-warn-600 flex items-center justify-center mx-auto mb-4 shadow-lg">
            <span className="text-2xl text-white">&#x1F6F5;</span>
          </div>
          <h1 className="text-2xl font-extrabold text-text-primary">{t("delivery.title")}</h1>
          <p className="text-sm text-text-muted">{t("delivery.loginDesc")}</p>
        </div>
        <input
          autoFocus
          type="password"
          inputMode="numeric"
          maxLength={6}
          value={pin}
          onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
          placeholder={t("delivery.enterPin")}
          className={`w-full px-4 py-3 rounded-xl border-2 text-center text-lg font-bold tracking-widest focus:outline-none mb-3 ${
            error ? "border-status-bad-400 bg-status-bad-50" : "border-sand-200 bg-white focus:border-ocean-400"
          }`}
        />
        {error && <p className="text-xs text-status-bad-500 text-center mb-3">{error}</p>}
        <button
          type="submit"
          disabled={loading || pin.length < 4}
          className="w-full py-3 rounded-xl bg-status-warn-500 text-white font-bold active:scale-[0.98] transition disabled:opacity-50"
        >
          {loading ? "..." : t("delivery.login")}
        </button>
      </form>
    </div>
  );
}

function downloadReceipt(order: DeliveryOrder) {
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Receipt #${order.orderNumber}</title>
<style>body{font-family:system-ui,sans-serif;max-width:350px;margin:20px auto;padding:20px;font-size:13px}
h1{font-size:16px;text-align:center;margin-bottom:4px}
.sub{text-align:center;color:#888;font-size:11px;margin-bottom:16px}
.line{display:flex;justify-content:space-between;padding:3px 0}
.sep{border-top:1px dashed #ccc;margin:8px 0}
.bold{font-weight:700}
.badge{display:inline-block;padding:2px 8px;border-radius:8px;font-size:10px;font-weight:700;background:#e8f5e9;color:#2e7d32}
</style></head><body>
<h1>Delivery Receipt</h1>
<p class="sub">#${order.orderNumber} — ${order.vipGuestName || "VIP"}</p>
<div class="sep"></div>
${order.items.map((i) => `<div class="line"><span>${i.quantity}x ${i.name}</span><span>${i.price * i.quantity} EGP</span></div>`).join("")}
<div class="sep"></div>
<div class="line"><span>Subtotal</span><span>${order.total - order.deliveryFee} EGP</span></div>
<div class="line"><span>Delivery fee</span><span>${order.deliveryFee} EGP</span></div>
<div class="sep"></div>
<div class="line bold"><span>Total</span><span>${order.total} EGP</span></div>
<div class="sep"></div>
${order.paymentMethod ? `<div class="line"><span>Payment</span><span class="badge">${order.paymentMethod}</span></div>` : ""}
${order.deliveryAddress ? `<div class="line"><span>Address</span><span>${order.deliveryAddress}</span></div>` : ""}
${order.vipGuestPhone ? `<div class="line"><span>Phone</span><span>${order.vipGuestPhone}</span></div>` : ""}
<p class="sub" style="margin-top:16px">${new Date().toLocaleString("en-EG")}</p>
</body></html>`;
  const blob = new Blob([html], { type: "text/html" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `receipt-${order.orderNumber}.html`;
  a.click();
  URL.revokeObjectURL(url);
}

function DeliveryCard({
  order,
  onStatusUpdate,
  isOwner,
}: {
  order: DeliveryOrder;
  onStatusUpdate: (orderId: string, status: string) => void;
  isOwner: boolean;
}) {
  const [updating, setUpdating] = useState(false);
  const { t } = useLanguage();
  const isUnassigned = !order.deliveryDriverId;

  const kitchenReady = order.status === "READY" || order.status === "SERVED" || order.status === "PAID";

  const nextStatus = (): { status: string; label: string; color: string } | null => {
    if (isUnassigned) return null;
    switch (order.deliveryStatus) {
      case "ASSIGNED": return kitchenReady ? { status: "ON_THE_WAY", label: t("delivery.pickedUpOnWay"), color: "bg-status-info-500" } : null;
      case "PICKED_UP":
      case "ON_THE_WAY": return { status: "DELIVERED", label: t("delivery.markDelivered"), color: "bg-status-good-500" };
      default: return null;
    }
  };

  const next = nextStatus();
  const statusColor =
    order.deliveryStatus === "DELIVERED" ? "bg-status-good-100 text-status-good-700" :
    order.deliveryStatus === "ON_THE_WAY" ? "bg-status-warn-100 text-status-warn-700" :
    order.deliveryStatus === "PICKED_UP" ? "bg-status-info-100 text-status-info-700" :
    isUnassigned ? "bg-status-warn-100 text-status-warn-700" :
    "bg-sand-100 text-text-muted";

  const statusLabel = order.deliveryStatus
    ? order.deliveryStatus.replace(/_/g, " ")
    : isUnassigned
      ? t("delivery.awaitingDriver")
      : `${t("delivery.kitchen")}: ${order.status}`;

  const mapsUrl = order.deliveryLat && order.deliveryLng
    ? `https://www.google.com/maps/dir/?api=1&destination=${order.deliveryLat},${order.deliveryLng}`
    : null;

  return (
    <div className="rounded-2xl bg-white border-2 border-sand-200 p-4 shadow-sm">
      <div className="flex items-center justify-between mb-3">
        <div>
          <span className="text-xs font-bold text-text-muted">#{order.orderNumber}</span>
          <h3 className="text-base font-bold text-text-primary">{order.vipGuestName || "VIP"}</h3>
          {isUnassigned && (
            <span className="text-[10px] text-status-warn-600 font-bold">{t("delivery.waitingDriver")}</span>
          )}
          {order.deliveryDriverName && isOwner && (
            <span className="text-[10px] text-text-muted font-bold">{t("delivery.driver")}: {order.deliveryDriverName}</span>
          )}
        </div>
        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full uppercase ${statusColor}`}>
          {statusLabel}
        </span>
      </div>

      {/* Kitchen status — shown when driver is assigned but food isn't ready yet */}
      {order.deliveryDriverId && !kitchenReady && (
        <div className="mb-3 flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-status-warn-400 animate-pulse" />
          <span className="text-[11px] font-bold text-status-warn-600 uppercase">
            {t("delivery.kitchen")}: {order.status === "CONFIRMED" ? t("delivery.confirmed") : order.status === "PREPARING" ? t("delivery.preparing") : order.status}
          </span>
        </div>
      )}
      {order.deliveryDriverId && kitchenReady && order.deliveryStatus === "ASSIGNED" && (
        <div className="mb-3 flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-status-good-500" />
          <span className="text-[11px] font-bold text-status-good-700 uppercase">{t("delivery.foodReady")}</span>
        </div>
      )}

      {/* Payment method */}
      {order.paymentMethod && (
        <div className="mb-3">
          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
            order.paymentMethod === "CASH" ? "bg-status-good-100 text-status-good-700" :
            order.paymentMethod === "CARD" ? "bg-status-info-100 text-status-info-700" :
            "bg-status-wait-100 text-status-wait-700"
          }`}>
            {order.paymentMethod === "CASH" ? t("delivery.cash") : order.paymentMethod === "CARD" ? t("delivery.card") : t("delivery.instapay")}
          </span>
        </div>
      )}

      {/* Items */}
      <div className="space-y-1 mb-3 pb-3 border-b border-sand-100">
        {order.items.map((item, i) => (
          <div key={i} className="flex justify-between text-sm">
            <span className="text-text-secondary">{item.quantity}x {item.name}</span>
            <span className="text-text-muted">{item.price * item.quantity} EGP</span>
          </div>
        ))}
        <div className="flex justify-between text-sm pt-1">
          <span className="text-text-muted">{t("delivery.subtotal")}</span>
          <span className="text-text-muted">{order.total - order.deliveryFee} EGP</span>
        </div>
        <div className="flex justify-between text-sm">
          <span className="text-text-muted">{t("delivery.deliveryFee")}</span>
          <span className="text-text-muted">{order.deliveryFee} EGP</span>
        </div>
        <div className="flex justify-between text-sm font-bold pt-1 border-t border-sand-100">
          <span>{t("delivery.totalToCollect")}</span>
          <span className="text-ocean-600">{order.total} EGP</span>
        </div>
      </div>

      {/* Address */}
      {order.deliveryAddress && (
        <div className="mb-3">
          <p className="text-xs font-bold text-text-muted uppercase mb-1">{t("delivery.address")}</p>
          <p className="text-sm text-text-primary">{order.deliveryAddress}</p>
          {order.deliveryNotes && (
            <p className="text-xs text-text-muted mt-0.5">{order.deliveryNotes}</p>
          )}
        </div>
      )}

      {/* Phone */}
      {order.vipGuestPhone && (
        <a href={`tel:${order.vipGuestPhone}`} className="inline-flex items-center gap-1.5 text-sm text-ocean-600 font-bold mb-3">
          &#x1F4DE; {order.vipGuestPhone}
        </a>
      )}

      {/* Actions */}
      <div className="flex gap-2">
        {mapsUrl && (
          <a
            href={mapsUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex-1 py-2.5 rounded-xl border-2 border-sand-200 text-center text-sm font-bold text-text-primary active:scale-95 transition"
          >
            &#x1F4CD; {t("delivery.navigate")}
          </a>
        )}
        {next && (
          <button
            onClick={async () => {
              setUpdating(true);
              await onStatusUpdate(order.id, next.status);
              setUpdating(false);
            }}
            disabled={updating}
            className={`flex-1 py-2.5 rounded-xl text-white text-sm font-bold active:scale-95 transition disabled:opacity-50 ${next.color}`}
          >
            {updating ? "..." : next.label}
          </button>
        )}
      </div>
      {/* Receipt download */}
      <button
        onClick={() => downloadReceipt(order)}
        className="w-full mt-2 py-2 rounded-xl border border-sand-200 text-xs font-bold text-text-muted active:scale-95 transition"
      >
        {t("delivery.downloadReceipt")}
      </button>
    </div>
  );
}

function DeliveryDashboard({ staff }: { staff: Staff }) {
  const [orders, setOrders] = useState<DeliveryOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [isOnline, setIsOnline] = useState(false);
  const [togglingOnline, setTogglingOnline] = useState(false);
  const isOwner = staff.role === "OWNER";
  const router = useRouter();
  const { t, lang, toggleLang } = useLanguage();

  // Fetch actual online status from DB on mount
  useEffect(() => {
    if (isOwner) return;
    fetch(`/api/delivery/online?staffId=${staff.id}`)
      .then((r) => r.json())
      .then((d) => setIsOnline(d.online))
      .catch(() => {});
  }, [staff.id, isOwner]);

  const fetchOrders = useCallback(async () => {
    const params = new URLSearchParams({ restaurantId: RESTAURANT_SLUG });
    if (!isOwner) params.set("driverId", staff.id);
    const res = await fetch(`/api/delivery?${params}`);
    if (res.ok) setOrders(await res.json());
    setLoading(false);
  }, [staff.id, isOwner]);

  // Poll orders + re-sync online status from DB each tick
  const pollRef = useRef(isOnline);
  pollRef.current = isOnline;
  const fetchAll = useCallback(async () => {
    fetchOrders();
    if (!isOwner) {
      fetch(`/api/delivery/online?staffId=${staff.id}`)
        .then((r) => r.json())
        .then((d) => {
          if (d.online !== pollRef.current) setIsOnline(d.online);
        })
        .catch(() => {});
    }
  }, [fetchOrders, staff.id, isOwner]);

  useEffect(() => {
    const stop = startPoll(fetchAll, 20_000);
    return stop;
  }, [fetchAll]);

  const updateStatus = async (orderId: string, deliveryStatus: string) => {
    await staffFetch(staff.id, `/api/delivery/${orderId}/status`, {
      method: "PATCH",
      body: JSON.stringify({ deliveryStatus, driverId: staff.id }),
    });
    fetchOrders();
  };

  const toggleOnline = async () => {
    setTogglingOnline(true);
    try {
      const res = await staffFetch(staff.id, "/api/delivery/online", {
        method: "PATCH",
        body: JSON.stringify({ staffId: staff.id, online: !isOnline }),
      });
      if (res.ok) {
        setIsOnline(!isOnline);
        // Refresh orders — going online may trigger auto-assignment
        if (!isOnline) setTimeout(fetchOrders, 1000);
      }
    } catch (err) {
      console.error("Failed to toggle online status:", err);
    } finally {
      setTogglingOnline(false);
    }
  };

  const handleLogout = async () => {
    // Set driver offline before logging out
    if (!isOwner && isOnline) {
      await staffFetch(staff.id, "/api/delivery/online", {
        method: "PATCH",
        body: JSON.stringify({ staffId: staff.id, online: false }),
      }).catch(() => {});
    }
    try {
      sessionStorage.removeItem("ttc_staff_unlocked");
      localStorage.removeItem(STORAGE_KEY);
    } catch {}
    router.push("/");
  };

  // Drivers see only their assigned orders; owners see everything
  const myActive = orders.filter((o) => o.deliveryDriverId === staff.id && o.deliveryStatus !== "DELIVERED");
  const unassigned = orders.filter((o) => !o.deliveryDriverId && o.deliveryStatus !== "DELIVERED");
  const othersActive = isOwner ? orders.filter((o) => o.deliveryDriverId && o.deliveryDriverId !== staff.id && o.deliveryStatus !== "DELIVERED") : [];
  const completed = orders.filter((o) => o.deliveryStatus === "DELIVERED");

  return (
    <div className="min-h-dvh bg-beach">
      <div className="max-w-lg mx-auto px-4 py-4">
        {/* Header */}
        <div className="flex items-center justify-between gap-2 mb-4 flex-wrap">
          <div className="min-w-0">
            <h1 className="text-lg font-extrabold text-text-primary flex items-center gap-2">
              {t("delivery.title")}
              {!isOwner && (
                <span className={`w-2.5 h-2.5 rounded-full ${isOnline ? "bg-status-good-500" : "bg-status-bad-500"} animate-pulse`} />
              )}
            </h1>
            <p className="text-xs text-text-muted truncate">{staff.name}{isOwner ? ` (${t("delivery.ownerView")})` : ""}</p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {!isOwner && (
              <button
                onClick={toggleOnline}
                disabled={togglingOnline}
                className={`px-3 sm:px-4 py-2 rounded-xl text-xs sm:text-sm font-bold transition active:scale-95 disabled:opacity-50 ${
                  isOnline
                    ? "bg-status-good-100 text-status-good-700 border-2 border-status-good-300"
                    : "bg-status-bad-100 text-status-bad-700 border-2 border-status-bad-300"
                }`}
              >
                {togglingOnline ? "..." : isOnline ? t("delivery.online") : t("delivery.offline")}
              </button>
            )}
            <LanguageToggle lang={lang} onToggle={toggleLang} />
            <button
              onClick={handleLogout}
              className="inline-flex items-center gap-1.5 px-3 h-8 rounded-full border bg-sand-100 text-text-muted hover:text-text-primary border-sand-200 text-[11px] font-bold uppercase tracking-wider transition active:scale-95"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                <polyline points="16 17 21 12 16 7" />
                <line x1="21" y1="12" x2="9" y2="12" />
              </svg>
              {t("delivery.logout")}
            </button>
          </div>
        </div>

        {/* Offline banner for drivers */}
        {!isOwner && !isOnline && (
          <div className="rounded-2xl bg-status-bad-50 border-2 border-status-bad-200 p-4 mb-4 text-center">
            <p className="text-sm font-bold text-status-bad-700">{t("delivery.youAreOffline")}</p>
            <p className="text-xs text-status-bad-500 mt-1">{t("delivery.goOnline")}</p>
          </div>
        )}

        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="w-8 h-8 border-3 border-status-warn-400 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : (
          <>
            {/* My active deliveries */}
            {myActive.length > 0 && (
              <div className="space-y-3 mb-6">
                <h2 className="text-xs font-bold text-text-muted uppercase tracking-wider">{t("delivery.myDeliveries")} ({myActive.length})</h2>
                {myActive.map((o) => (
                  <DeliveryCard key={o.id} order={o} onStatusUpdate={updateStatus} isOwner={isOwner} />
                ))}
              </div>
            )}

            {/* Unassigned orders — visible to owner and online drivers */}
            {unassigned.length > 0 && (isOwner || isOnline) && (
              <div className="space-y-3 mb-6">
                <h2 className="text-xs font-bold text-status-warn-600 uppercase tracking-wider flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-status-warn-400 animate-pulse" />
                  {t("delivery.awaitingDriverSection")} ({unassigned.length})
                </h2>
                {unassigned.map((o) => (
                  <DeliveryCard key={o.id} order={o} onStatusUpdate={updateStatus} isOwner={isOwner} />
                ))}
              </div>
            )}

            {/* Other drivers' active deliveries — owner only */}
            {othersActive.length > 0 && (
              <div className="space-y-3 mb-6">
                <h2 className="text-xs font-bold text-text-muted uppercase tracking-wider">{t("delivery.otherDrivers")} ({othersActive.length})</h2>
                {othersActive.map((o) => (
                  <DeliveryCard key={o.id} order={o} onStatusUpdate={updateStatus} isOwner={isOwner} />
                ))}
              </div>
            )}

            {/* Empty state */}
            {myActive.length === 0 && unassigned.length === 0 && othersActive.length === 0 && (
              <div className="rounded-2xl bg-sand-50 border-2 border-sand-200 p-8 text-center mb-6">
                <span className="text-3xl mb-2 block">&#x1F6F5;</span>
                <p className="text-sm text-text-muted font-bold">{t("delivery.noActive")}</p>
                <p className="text-xs text-text-muted mt-1">
                  {!isOwner && !isOnline ? t("delivery.goOnlineShort") : t("delivery.autoAssign")}
                </p>
              </div>
            )}

            {/* Completed */}
            {completed.length > 0 && (
              <div className="space-y-3">
                <h2 className="text-xs font-bold text-text-muted uppercase tracking-wider">{t("delivery.completedToday")} ({completed.length})</h2>
                {completed.map((o) => (
                  <div key={o.id} className="rounded-xl bg-sand-50 border border-sand-200 p-3">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-bold text-text-secondary">#{o.orderNumber} — {o.vipGuestName || "VIP"}</span>
                      <span className="text-xs text-status-good-600 font-bold">{o.total} EGP</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

export default function DeliveryPage() {
  const [staff, setStaff] = useState<Staff | null>(null);

  if (!staff) return <LoginScreen onLogin={setStaff} />;
  return <DeliveryDashboard staff={staff} />;
}
