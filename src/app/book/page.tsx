"use client";

import { useEffect, useMemo, useState } from "react";

type RoomType = {
  id: string;
  name: string;
  description: string | null;
  capacity: number;
  baseRate: string | number;
  amenities: string[];
};

type AvailableType = RoomType & { availableCount: number };

type Hotel = {
  id: string;
  name: string;
  address: string | null;
  checkInTime: string;
  checkOutTime: string;
  roomTypes: RoomType[];
};

function fmtEGP(n: string | number) {
  return Math.round(Number(n)).toLocaleString("en-EG");
}
function todayISO() {
  return new Date().toISOString().slice(0, 10);
}
function addDaysISO(iso: string, days: number) {
  const d = new Date(iso);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export default function BookPage() {
  const restaurantSlug =
    process.env.NEXT_PUBLIC_RESTAURANT_SLUG || "neom-dahab";
  const [hotel, setHotel] = useState<Hotel | null>(null);
  const [loadingHotel, setLoadingHotel] = useState(true);

  const [from, setFrom] = useState(todayISO());
  const [to, setTo] = useState(addDaysISO(todayISO(), 1));
  const [adults, setAdults] = useState(2);
  const [children, setChildren] = useState(0);
  const [available, setAvailable] = useState<AvailableType[] | null>(null);
  const [searching, setSearching] = useState(false);

  const [pickedType, setPickedType] = useState<AvailableType | null>(null);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [nationality, setNationality] = useState("");
  const [specialRequests, setSpecialRequests] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const [confirmation, setConfirmation] = useState<{
    reservationId: string;
    roomNumber: string;
    nights: number;
    totalEstimate: number;
  } | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/book/info?slug=${restaurantSlug}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => setHotel(d.hotel || null))
      .finally(() => setLoadingHotel(false));
  }, [restaurantSlug]);

  const nights = useMemo(() => {
    const d = new Date(to).getTime() - new Date(from).getTime();
    return Math.max(0, Math.round(d / (1000 * 60 * 60 * 24)));
  }, [from, to]);

  async function search() {
    setErr(null);
    if (!from || !to || nights < 1) {
      setErr("Pick a valid date range (at least 1 night).");
      return;
    }
    setSearching(true);
    setAvailable(null);
    setPickedType(null);
    try {
      const res = await fetch(
        `/api/book/availability?slug=${restaurantSlug}&from=${from}&to=${to}`,
        { cache: "no-store" }
      );
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Search failed");
      // Filter out types that can't fit the party.
      const fit = (d.types as AvailableType[]).filter(
        (t) => t.capacity >= adults
      );
      setAvailable(fit);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Search failed");
    } finally {
      setSearching(false);
    }
  }

  async function submit() {
    if (!pickedType) return;
    if (!name.trim()) {
      setErr("Please enter your name.");
      return;
    }
    setErr(null);
    setSubmitting(true);
    try {
      const res = await fetch("/api/book/reserve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slug: restaurantSlug,
          roomTypeId: pickedType.id,
          from,
          to,
          adults,
          children,
          guest: {
            name: name.trim(),
            phone: phone.trim() || null,
            email: email.trim() || null,
            nationality: nationality.trim() || null,
          },
          specialRequests: specialRequests.trim() || null,
        }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Booking failed");
      setConfirmation({
        reservationId: d.reservationId,
        roomNumber: d.roomNumber,
        nights: d.nights,
        totalEstimate: d.totalEstimate,
      });
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Booking failed");
    } finally {
      setSubmitting(false);
    }
  }

  if (loadingHotel) {
    return (
      <div className="min-h-dvh bg-gradient-to-br from-amber-50 to-sand-100 flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-sand-300 border-t-amber-600 rounded-full animate-spin" />
      </div>
    );
  }

  if (!hotel) {
    return (
      <div className="min-h-dvh bg-gradient-to-br from-amber-50 to-sand-100 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-lg p-8 max-w-sm text-center">
          <h1 className="text-xl font-extrabold text-ink">Booking unavailable</h1>
          <p className="text-sm text-ink-soft mt-2">
            Direct booking isn't available right now. Please contact us directly.
          </p>
        </div>
      </div>
    );
  }

  if (confirmation) {
    return (
      <div className="min-h-dvh bg-gradient-to-br from-amber-50 to-sand-100">
        <main className="max-w-xl mx-auto p-6">
          <div className="bg-white rounded-2xl shadow-lg p-8 text-center">
            <div className="text-5xl mb-3">✅</div>
            <h1 className="text-2xl font-extrabold text-ink">
              Reservation confirmed
            </h1>
            <p className="text-sm text-ink-soft mt-2">
              We've reserved <strong>Room {confirmation.roomNumber}</strong> at{" "}
              <strong>{hotel.name}</strong> for{" "}
              <strong>
                {confirmation.nights} night{confirmation.nights === 1 ? "" : "s"}
              </strong>
              .
            </p>
            <div className="mt-5 bg-sand-50 rounded-lg p-4 text-left">
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div>
                  <div className="text-[11px] uppercase tracking-wider text-ink-mute font-bold">
                    Check in
                  </div>
                  <div className="font-extrabold">{from}</div>
                </div>
                <div>
                  <div className="text-[11px] uppercase tracking-wider text-ink-mute font-bold">
                    Check out
                  </div>
                  <div className="font-extrabold">{to}</div>
                </div>
                <div>
                  <div className="text-[11px] uppercase tracking-wider text-ink-mute font-bold">
                    Estimated total
                  </div>
                  <div className="font-extrabold">
                    {fmtEGP(confirmation.totalEstimate)} EGP
                  </div>
                </div>
                <div>
                  <div className="text-[11px] uppercase tracking-wider text-ink-mute font-bold">
                    Booking ref
                  </div>
                  <div className="font-mono text-xs">
                    {confirmation.reservationId.slice(-10).toUpperCase()}
                  </div>
                </div>
              </div>
            </div>
            <p className="text-xs text-ink-mute mt-5">
              The front desk will see your reservation and have your room
              ready. If you change your plans, contact us before{" "}
              {hotel.checkInTime} on the check-in date. Add-ons (cafe, kayak,
              massage, etc.) can be charged to your room during your stay.
            </p>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-dvh bg-gradient-to-br from-amber-50 to-sand-100">
      <header className="bg-white/70 backdrop-blur border-b border-sand-200">
        <div className="max-w-3xl mx-auto px-4 py-5">
          <p className="text-[11px] font-extrabold uppercase tracking-wider text-amber-700">
            {hotel.address || "Dahab, Egypt"}
          </p>
          <h1 className="text-3xl font-extrabold text-ink mt-1">
            Book {hotel.name}
          </h1>
          <p className="text-sm text-ink-soft mt-2 max-w-xl">
            Direct booking. No middleman, no surprise fees. Check-in from{" "}
            {hotel.checkInTime}, check-out by {hotel.checkOutTime}.
          </p>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 py-6 space-y-6">
        {/* Search box */}
        <section className="bg-white rounded-2xl shadow-sm border border-sand-200 p-5">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <label className="block">
              <div className="text-[10px] font-bold uppercase tracking-wider text-ink-mute mb-1">
                Check in
              </div>
              <input
                type="date"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
                min={todayISO()}
                className="w-full px-3 py-2 border border-sand-300 rounded-lg"
              />
            </label>
            <label className="block">
              <div className="text-[10px] font-bold uppercase tracking-wider text-ink-mute mb-1">
                Check out
              </div>
              <input
                type="date"
                value={to}
                onChange={(e) => setTo(e.target.value)}
                min={addDaysISO(from, 1)}
                className="w-full px-3 py-2 border border-sand-300 rounded-lg"
              />
            </label>
            <label className="block">
              <div className="text-[10px] font-bold uppercase tracking-wider text-ink-mute mb-1">
                Adults
              </div>
              <input
                type="number"
                min={1}
                value={adults}
                onChange={(e) => setAdults(Number(e.target.value) || 1)}
                className="w-full px-3 py-2 border border-sand-300 rounded-lg"
              />
            </label>
            <label className="block">
              <div className="text-[10px] font-bold uppercase tracking-wider text-ink-mute mb-1">
                Children
              </div>
              <input
                type="number"
                min={0}
                value={children}
                onChange={(e) => setChildren(Number(e.target.value) || 0)}
                className="w-full px-3 py-2 border border-sand-300 rounded-lg"
              />
            </label>
          </div>
          <button
            onClick={search}
            disabled={searching}
            className="mt-4 w-full py-3 bg-amber-600 hover:bg-amber-700 text-white font-extrabold rounded-xl disabled:opacity-50"
          >
            {searching
              ? "Searching…"
              : `Find rooms — ${nights} night${nights === 1 ? "" : "s"}`}
          </button>
        </section>

        {err && (
          <div className="p-3 bg-status-bad-50 text-status-bad-700 rounded-lg text-sm">
            {err}
          </div>
        )}

        {/* Available types */}
        {available !== null && (
          <section>
            <h2 className="text-[11px] font-extrabold uppercase tracking-wider text-ink-mute mb-2 px-1">
              {available.length === 0
                ? "Sorry, nothing available for those dates"
                : `${available.length} room type${
                    available.length === 1 ? "" : "s"
                  } available`}
            </h2>
            <div className="space-y-3">
              {available.map((t) => {
                const totalForStay = Number(t.baseRate) * Math.max(1, nights);
                const picked = pickedType?.id === t.id;
                return (
                  <div
                    key={t.id}
                    className={`bg-white rounded-2xl shadow-sm border p-5 transition ${
                      picked
                        ? "border-amber-500 ring-2 ring-amber-200"
                        : "border-sand-200"
                    }`}
                  >
                    <div className="flex items-baseline justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <h3 className="text-lg font-extrabold text-ink">
                          {t.name}
                        </h3>
                        {t.description && (
                          <p className="text-sm text-ink-soft mt-1">
                            {t.description}
                          </p>
                        )}
                        <div className="mt-2 flex flex-wrap gap-1">
                          {t.amenities.map((a) => (
                            <span
                              key={a}
                              className="px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider bg-sand-100 text-ink-soft rounded"
                            >
                              {a.replace(/-/g, " ")}
                            </span>
                          ))}
                        </div>
                        <p className="text-[11px] text-ink-mute mt-2">
                          Sleeps up to {t.capacity} · {t.availableCount} room
                          {t.availableCount === 1 ? "" : "s"} left
                        </p>
                      </div>
                      <div className="text-right shrink-0">
                        <div className="text-2xl font-extrabold text-amber-700 tabular-nums">
                          {fmtEGP(t.baseRate)}
                        </div>
                        <div className="text-[10px] font-bold text-ink-mute">
                          EGP / NIGHT
                        </div>
                        <div className="text-[11px] text-ink-mute mt-1">
                          {fmtEGP(totalForStay)} EGP total
                        </div>
                      </div>
                    </div>
                    <button
                      onClick={() => setPickedType(t)}
                      className={`mt-4 w-full py-2.5 rounded-xl font-extrabold text-sm transition ${
                        picked
                          ? "bg-amber-700 text-white"
                          : "bg-amber-100 text-amber-800 hover:bg-amber-200"
                      }`}
                    >
                      {picked ? "Selected ✓" : "Select"}
                    </button>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {/* Guest details + confirm */}
        {pickedType && (
          <section className="bg-white rounded-2xl shadow-sm border border-sand-200 p-5">
            <h2 className="text-sm font-extrabold uppercase tracking-wider text-ink-mute mb-3">
              Your details
            </h2>
            <div className="space-y-3">
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Full name *"
                className="w-full px-3 py-2 border border-sand-300 rounded-lg"
              />
              <div className="grid grid-cols-2 gap-2">
                <input
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="Phone"
                  className="px-3 py-2 border border-sand-300 rounded-lg"
                />
                <input
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="Email"
                  type="email"
                  className="px-3 py-2 border border-sand-300 rounded-lg"
                />
              </div>
              <input
                value={nationality}
                onChange={(e) => setNationality(e.target.value)}
                placeholder="Nationality"
                className="w-full px-3 py-2 border border-sand-300 rounded-lg"
              />
              <textarea
                value={specialRequests}
                onChange={(e) => setSpecialRequests(e.target.value)}
                placeholder="Special requests (optional)"
                rows={3}
                className="w-full px-3 py-2 border border-sand-300 rounded-lg"
              />
            </div>
            <button
              onClick={submit}
              disabled={submitting || !name.trim()}
              className="mt-4 w-full py-3 bg-amber-600 hover:bg-amber-700 text-white font-extrabold rounded-xl disabled:opacity-50"
            >
              {submitting
                ? "Booking…"
                : `Confirm — ${fmtEGP(
                    Number(pickedType.baseRate) * Math.max(1, nights)
                  )} EGP`}
            </button>
            <p className="text-[11px] text-ink-mute mt-2 text-center">
              No payment now. You'll settle at check-out.
            </p>
          </section>
        )}
      </main>
    </div>
  );
}
