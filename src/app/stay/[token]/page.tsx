"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";

type FolioCharge = {
  type: string;
  amount: string | number;
  description: string;
  chargedAt: string;
  night: string | null;
};

type Reservation = {
  status: string;
  checkInDate: string;
  checkOutDate: string;
  checkedInAt: string | null;
  checkedOutAt: string | null;
  adults: number;
  children: number;
  specialRequests: string | null;
  guest: { name: string };
  room: { number: string; roomType: { name: string } };
  hotel: {
    name: string;
    checkOutTime: string;
    restaurant: { instapayHandle: string | null; instapayPhone: string | null };
  };
  folio: {
    status: string;
    openingDeposit: string | number;
    settledTotal: string | number | null;
    settledAt: string | null;
    settledMethod: string | null;
    charges: FolioCharge[];
  } | null;
};

function fmtEGP(n: string | number | null | undefined) {
  return Math.round(Number(n || 0)).toLocaleString("en-EG");
}

function fmtDate(iso: string) {
  return new Date(iso).toISOString().slice(0, 10);
}

export default function StayPage() {
  const params = useParams<{ token: string }>();
  const [data, setData] = useState<{
    reservation: Reservation;
    balance: number;
  } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch(`/api/stay/${params.token}`, {
          cache: "no-store",
        });
        if (!res.ok) {
          const d = await res.json().catch(() => ({}));
          throw new Error(d.error || "Stay not found");
        }
        const d = await res.json();
        if (!cancelled) setData(d);
      } catch (e) {
        if (!cancelled) setErr(e instanceof Error ? e.message : "Failed");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    const t = setInterval(load, 30000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [params.token]);

  if (loading && !data) {
    return (
      <div className="min-h-dvh bg-gradient-to-br from-amber-50 to-sand-100 flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-sand-300 border-t-amber-600 rounded-full animate-spin" />
      </div>
    );
  }

  if (err || !data) {
    return (
      <div className="min-h-dvh bg-gradient-to-br from-amber-50 to-sand-100 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-lg p-8 max-w-sm text-center">
          <div className="text-4xl mb-2">🛏️</div>
          <h1 className="text-xl font-extrabold text-ink mb-1">Stay not found</h1>
          <p className="text-sm text-ink-soft">
            {err ||
              "The link may have expired. Please ask the front desk for a fresh link."}
          </p>
        </div>
      </div>
    );
  }

  const r = data.reservation;
  const charges = r.folio?.charges || [];
  const balance = data.balance;
  const settled = r.folio?.status === "SETTLED";

  // Group charges by type for a nicer summary section.
  const byType: Record<string, { items: FolioCharge[]; total: number }> = {};
  for (const c of charges) {
    const key = c.type;
    if (!byType[key]) byType[key] = { items: [], total: 0 };
    byType[key].items.push(c);
    byType[key].total += Number(c.amount);
  }
  const typeOrder: [string, string][] = [
    ["ROOM_NIGHT", "Room"],
    ["FOOD", "Cafe"],
    ["ACTIVITY", "Activities"],
    ["MINIBAR", "Minibar"],
    ["MISC", "Other"],
  ];

  return (
    <div className="min-h-dvh bg-gradient-to-br from-amber-50 to-sand-100">
      <header className="bg-white/70 backdrop-blur border-b border-sand-200">
        <div className="max-w-2xl mx-auto px-4 py-4">
          <p className="text-[11px] font-extrabold uppercase tracking-wider text-amber-700">
            {r.hotel.name}
          </p>
          <h1 className="text-2xl font-extrabold text-ink mt-1">
            Welcome, {r.guest.name.split(" ")[0]}.
          </h1>
          <p className="text-sm text-ink-soft mt-1">
            Room {r.room.number} · {r.room.roomType.name}
          </p>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-6 space-y-6">
        {/* Stay summary */}
        <section className="bg-white rounded-2xl shadow-sm border border-sand-200 p-5">
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <div className="text-[11px] font-bold uppercase tracking-wider text-ink-mute">
                Check in
              </div>
              <div className="font-extrabold">{fmtDate(r.checkInDate)}</div>
            </div>
            <div>
              <div className="text-[11px] font-bold uppercase tracking-wider text-ink-mute">
                Check out
              </div>
              <div className="font-extrabold">
                {fmtDate(r.checkOutDate)}
                <span className="font-normal text-ink-mute ms-1">
                  by {r.hotel.checkOutTime}
                </span>
              </div>
            </div>
            <div>
              <div className="text-[11px] font-bold uppercase tracking-wider text-ink-mute">
                Status
              </div>
              <div className="font-extrabold capitalize">
                {r.status === "CHECKED_IN"
                  ? "Checked in"
                  : r.status === "CHECKED_OUT"
                  ? "Checked out"
                  : r.status === "BOOKED"
                  ? "Booked"
                  : r.status.toLowerCase()}
              </div>
            </div>
            <div>
              <div className="text-[11px] font-bold uppercase tracking-wider text-ink-mute">
                Guests
              </div>
              <div className="font-extrabold">
                {r.adults} adult{r.adults === 1 ? "" : "s"}
                {r.children > 0 &&
                  `, ${r.children} child${r.children === 1 ? "" : "ren"}`}
              </div>
            </div>
          </div>
          {r.specialRequests && (
            <div className="mt-4 pt-3 border-t border-sand-100 text-xs text-ink-soft">
              <span className="font-bold">Your requests:</span> {r.specialRequests}
            </div>
          )}
        </section>

        {/* Folio balance */}
        <section className="bg-gradient-to-br from-amber-100 to-amber-50 border border-amber-200 rounded-2xl p-5">
          <div className="flex items-baseline justify-between">
            <div>
              <div className="text-[11px] font-extrabold uppercase tracking-wider text-amber-800">
                {settled ? "Final amount paid" : "Current folio"}
              </div>
              <div className="text-3xl font-extrabold text-amber-900 mt-1 tabular-nums">
                {fmtEGP(settled ? r.folio?.settledTotal : balance)} EGP
              </div>
            </div>
            {settled && r.folio?.settledMethod && (
              <div className="text-xs font-bold text-amber-700">
                Paid via {r.folio.settledMethod.toLowerCase()}
              </div>
            )}
          </div>
          {!settled && (
            <p className="text-xs text-amber-700 mt-2">
              You'll settle this at the front desk on checkout. Updates
              automatically as charges are added.
            </p>
          )}
        </section>

        {/* Charges grouped by type */}
        <section>
          <h2 className="text-[11px] font-extrabold uppercase tracking-wider text-ink-mute mb-2 px-1">
            What's on your folio
          </h2>
          {charges.length === 0 ? (
            <div className="bg-white rounded-2xl border border-sand-200 p-6 text-sm text-ink-mute text-center">
              No charges yet.
            </div>
          ) : (
            <div className="bg-white rounded-2xl border border-sand-200 overflow-hidden divide-y divide-sand-100">
              {typeOrder
                .filter(([k]) => byType[k])
                .map(([k, label]) => (
                  <div key={k} className="px-4 py-3">
                    <div className="flex items-baseline justify-between mb-1">
                      <div className="text-sm font-extrabold text-ink">
                        {label}
                      </div>
                      <div className="text-sm font-extrabold tabular-nums">
                        {fmtEGP(byType[k].total)} EGP
                      </div>
                    </div>
                    <ul className="text-xs text-ink-soft space-y-0.5">
                      {byType[k].items.map((c, i) => (
                        <li key={i} className="flex justify-between">
                          <span className="truncate me-2">{c.description}</span>
                          <span className="tabular-nums">
                            {fmtEGP(c.amount)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
            </div>
          )}
        </section>

        {/* InstaPay handle for advance settlement */}
        {!settled && r.hotel.restaurant.instapayHandle && (
          <section className="bg-white rounded-2xl border border-sand-200 p-5">
            <h2 className="text-[11px] font-extrabold uppercase tracking-wider text-ink-mute mb-2">
              Want to pay early?
            </h2>
            <p className="text-sm text-ink-soft mb-2">
              You can settle in advance via InstaPay to:
            </p>
            <div className="bg-sand-50 rounded-lg p-3 font-mono text-sm font-bold text-ink">
              {r.hotel.restaurant.instapayHandle}
            </div>
            <p className="text-[11px] text-ink-mute mt-2">
              Show the front desk your transfer confirmation when you check
              out.
            </p>
          </section>
        )}

        <p className="text-[11px] text-ink-mute text-center pt-4 pb-8">
          {r.hotel.name} · This page updates automatically.
        </p>
      </main>
    </div>
  );
}
