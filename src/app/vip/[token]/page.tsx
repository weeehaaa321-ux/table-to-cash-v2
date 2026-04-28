"use client";

import { useEffect, useState, useCallback, lazy, Suspense } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useCart } from "@/store/cart";

const LocationPicker = lazy(() =>
  import("@/presentation/components/ui/LocationPicker").then((m) => ({ default: m.LocationPicker }))
);

type VipData = {
  id: string;
  name: string;
  phone: string;
  address: string | null;
  addressNotes: string | null;
  locationLat: number | null;
  locationLng: number | null;
  restaurant: { id: string; name: string; slug: string; currency: string };
};

export default function VipEntryPage() {
  const { token } = useParams<{ token: string }>();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [vip, setVip] = useState<VipData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [mode, setMode] = useState<"choose" | "delivery">("choose");
  const [address, setAddress] = useState("");
  const [addressNotes, setAddressNotes] = useState("");
  const [locationLat, setLocationLat] = useState<number | null>(null);
  const [locationLng, setLocationLng] = useState<number | null>(null);
  const [creating, setCreating] = useState(false);
  const [deliveryAvailable, setDeliveryAvailable] = useState(false);

  const cart = useCart();

  useEffect(() => {
    fetch(`/api/vip/${token}`)
      .then((r) => {
        if (!r.ok) throw new Error("VIP link not found");
        return r.json();
      })
      .then((data: VipData) => {
        setVip(data);
        setAddress(data.address || "");
        setAddressNotes(data.addressNotes || "");
        setLocationLat(data.locationLat);
        setLocationLng(data.locationLng);

        // Check if delivery drivers are online
        fetch(`/api/delivery/available?restaurantId=${data.restaurant.slug}`)
          .then((r) => r.json())
          .then((d) => setDeliveryAvailable(d.available))
          .catch(() => {});
      })
      .catch(() => setError("This VIP link is invalid or inactive."))
      .finally(() => setLoading(false));
  }, [token]);

  // Auto-redirect if coming back with an existing session
  useEffect(() => {
    const sid = searchParams.get("session");
    if (sid && vip) {
      router.push(`/menu?slug=${vip.restaurant.slug}&sessionId=${sid}&vip=1&vipGuestId=${vip.id}&vipName=${encodeURIComponent(vip.name)}`);
    }
  }, [searchParams, vip, router]);

  const startSession = async (orderType: "VIP_DINE_IN" | "DELIVERY") => {
    if (!vip) return;
    setCreating(true);

    // Save delivery address back to VIP profile if changed
    if (orderType === "DELIVERY" && (address !== vip.address || locationLat !== vip.locationLat)) {
      fetch(`/api/vip/${token}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address, addressNotes, locationLat, locationLng }),
      }).catch(() => {});
    }

    try {
      const res = await fetch("/api/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          restaurantId: vip.restaurant.slug,
          orderType,
          vipGuestId: vip.id,
          guestCount: 1,
        }),
      });

      if (!res.ok) throw new Error("Failed to create session");
      const session = await res.json();

      // Store VIP state
      cart.setSessionId(session.id);
      cart.setIsSessionOwner(true);
      cart.setGuestNumber(1);
      cart.setHasPaymentAuthority(true);

      if (typeof window !== "undefined") {
        try {
          localStorage.setItem("ttc_vip_token", token);
          localStorage.setItem("ttc_vip_guestId", vip.id);
          localStorage.setItem("ttc_vip_name", vip.name);
          localStorage.setItem("ttc_vip_orderType", orderType);
          if (orderType === "DELIVERY") {
            localStorage.setItem("ttc_vip_deliveryAddress", address);
            localStorage.setItem("ttc_vip_deliveryNotes", addressNotes);
            if (locationLat != null) localStorage.setItem("ttc_vip_deliveryLat", String(locationLat));
            if (locationLng != null) localStorage.setItem("ttc_vip_deliveryLng", String(locationLng));
          }
        } catch {}
      }

      router.push(`/menu?slug=${vip.restaurant.slug}&sessionId=${session.id}&vip=1&vipGuestId=${vip.id}&vipName=${encodeURIComponent(vip.name)}&orderType=${orderType}`);
    } catch {
      setError("Failed to start session. Please try again.");
      setCreating(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-dvh bg-beach flex items-center justify-center">
        <div className="w-8 h-8 border-3 border-ocean-400 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (error || !vip) {
    return (
      <div className="min-h-dvh bg-beach flex items-center justify-center p-6">
        <div className="text-center max-w-sm">
          <div className="w-16 h-16 rounded-full bg-status-bad-100 flex items-center justify-center mx-auto mb-4 text-2xl">!</div>
          <h1 className="text-lg font-bold text-text-primary mb-2">Invalid Link</h1>
          <p className="text-sm text-text-muted">{error || "This VIP link is not active."}</p>
        </div>
      </div>
    );
  }

  if (mode === "delivery") {
    return (
      <div className="min-h-dvh bg-beach">
        <div className="max-w-md mx-auto px-5 py-8">
          <button onClick={() => setMode("choose")} className="text-ocean-600 text-xs font-extrabold uppercase tracking-wider mb-6 flex items-center gap-1.5 active:scale-95 transition">
            <span>&larr;</span> Back
          </button>

          <p className="text-[10px] font-extrabold text-text-muted uppercase tracking-[0.25em] mb-1">Step 2 of 2</p>
          <h1 className="text-3xl font-extrabold text-text-primary mb-2 tracking-tight">Delivery Details</h1>
          <p className="text-sm text-text-muted mb-8">Confirm your delivery address</p>

          <div className="space-y-5">
            <div>
              <label className="block text-[10px] font-extrabold text-text-muted mb-2 uppercase tracking-widest">Delivery Address</label>
              <input
                type="text"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                placeholder="e.g. 15 Mashraba St, Dahab"
                className="w-full px-4 py-3.5 rounded-xl border-2 border-sand-200 bg-white text-text-primary font-semibold focus:border-ocean-400 focus:outline-none text-sm transition"
              />
            </div>

            <div>
              <label className="block text-[10px] font-extrabold text-text-muted mb-2 uppercase tracking-widest">Notes for Driver</label>
              <textarea
                value={addressNotes}
                onChange={(e) => setAddressNotes(e.target.value)}
                placeholder="e.g. Blue gate, 2nd floor, ring doorbell"
                rows={2}
                className="w-full px-4 py-3.5 rounded-xl border-2 border-sand-200 bg-white text-text-primary focus:border-ocean-400 focus:outline-none text-sm resize-none transition"
              />
            </div>

            <div>
              <label className="block text-[10px] font-extrabold text-text-muted mb-2 uppercase tracking-widest">Location Pin</label>
              <Suspense fallback={
                <div className="w-full h-[220px] rounded-xl border-2 border-sand-200 bg-sand-50 flex items-center justify-center">
                  <div className="w-6 h-6 border-2 border-ocean-400 border-t-transparent rounded-full animate-spin" />
                </div>
              }>
                <LocationPicker
                  lat={locationLat}
                  lng={locationLng}
                  onLocationChange={(lat, lng) => {
                    setLocationLat(lat);
                    setLocationLng(lng);
                  }}
                />
              </Suspense>
            </div>
          </div>

          <button
            onClick={() => startSession("DELIVERY")}
            disabled={!address.trim() || creating}
            className="w-full mt-8 py-4 rounded-2xl bg-gradient-to-r from-ocean-500 to-ocean-600 text-white font-extrabold text-sm uppercase tracking-wider shadow-lg disabled:opacity-50 active:scale-[0.98] transition"
          >
            {creating ? "Starting..." : "Continue to Menu"}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-dvh bg-beach">
      <div className="max-w-md mx-auto px-5 py-8">
        {/* Welcome */}
        <div className="text-center mb-10">
          <div className="w-24 h-24 rounded-full bg-gradient-to-br from-status-warn-400 to-status-warn-600 flex items-center justify-center mx-auto mb-5 shadow-xl">
            <span className="text-4xl text-white font-extrabold">V</span>
          </div>
          <p className="text-[10px] font-extrabold text-text-muted uppercase tracking-[0.25em] mb-2">VIP Experience</p>
          <h1 className="text-3xl font-extrabold text-text-primary tracking-tight leading-tight">
            Welcome back,<br />{vip.name}
          </h1>
          <p className="text-sm text-text-muted mt-2 font-medium">
            {vip.restaurant.name}
          </p>
        </div>

        {/* Choice cards */}
        <div className="space-y-4">
          <button
            onClick={() => startSession("VIP_DINE_IN")}
            disabled={creating}
            className="w-full text-left"
          >
            <div className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-ocean-500 to-ocean-600 p-6 shadow-lg transition-all active:scale-[0.98]">
              <div className="absolute top-0 right-0 w-32 h-32 bg-white/10 rounded-full -translate-y-8 translate-x-8" />
              <div className="relative flex items-center gap-4">
                <div className="w-16 h-16 rounded-xl bg-white/20 flex items-center justify-center text-3xl flex-shrink-0">
                  &#x2615;
                </div>
                <div className="flex-1">
                  <p className="text-white/60 text-[10px] font-extrabold uppercase tracking-widest mb-0.5">Option A</p>
                  <h2 className="text-white font-extrabold text-2xl tracking-tight leading-none">Dine In</h2>
                  <p className="text-white/70 text-xs mt-1.5">Order at the cafe — no table needed</p>
                </div>
                <span className="text-white/40 text-2xl">&rarr;</span>
              </div>
            </div>
          </button>

          <button
            onClick={() => { if (deliveryAvailable && !creating) setMode("delivery"); }}
            disabled={creating || !deliveryAvailable}
            className={`w-full text-left ${!deliveryAvailable ? "pointer-events-none" : ""}`}
          >
            <div className={`relative overflow-hidden rounded-2xl p-6 shadow-lg transition-all ${
              deliveryAvailable
                ? "bg-gradient-to-r from-status-warn-500 to-status-warn-600 active:scale-[0.98]"
                : "bg-gradient-to-r from-sand-300 to-sand-400 opacity-60 grayscale"
            }`}>
              <div className="absolute top-0 right-0 w-32 h-32 bg-white/10 rounded-full -translate-y-8 translate-x-8" />
              <div className="relative flex items-center gap-4">
                <div className="w-16 h-16 rounded-xl bg-white/20 flex items-center justify-center text-3xl flex-shrink-0">
                  &#x1F6F5;
                </div>
                <div className="flex-1">
                  <p className="text-white/60 text-[10px] font-extrabold uppercase tracking-widest mb-0.5">Option B</p>
                  <h2 className="text-white font-extrabold text-2xl tracking-tight leading-none">Delivery</h2>
                  <p className="text-white/70 text-xs mt-1.5">
                    {deliveryAvailable ? "Get it delivered to your door" : "Currently unavailable"}
                  </p>
                </div>
                {deliveryAvailable && <span className="text-white/40 text-2xl">&rarr;</span>}
              </div>
            </div>
          </button>
        </div>

        {creating && (
          <div className="flex items-center justify-center gap-2 mt-6 text-sm text-text-muted">
            <div className="w-4 h-4 border-2 border-ocean-400 border-t-transparent rounded-full animate-spin" />
            Starting your session...
          </div>
        )}
      </div>
    </div>
  );
}
