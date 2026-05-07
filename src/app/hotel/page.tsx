"use client";

import { useEffect, useMemo, useState } from "react";

/**
 * Wrapper around fetch that injects x-staff-id from the hotel_staff
 * localStorage entry. Used by every authenticated call from this
 * page so we don't have to thread staff.id through every component
 * and modal as a prop.
 */
function authedFetch(url: string, init?: RequestInit): Promise<Response> {
  const headers = new Headers(init?.headers);
  if (!headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  try {
    const saved = typeof window !== "undefined" ? localStorage.getItem("hotel_staff") : null;
    if (saved) {
      const parsed = JSON.parse(saved);
      if (parsed?.id) headers.set("x-staff-id", parsed.id);
    }
  } catch {}
  return fetch(url, { ...init, headers });
}

// ───────────────────────────────────────────────
// Types — server returns these from /api/hotel/*
// ───────────────────────────────────────────────

type Hotel = {
  id: string;
  name: string;
  address: string | null;
  checkInTime: string;
  checkOutTime: string;
};

type RoomType = {
  id: string;
  name: string;
  description: string | null;
  capacity: number;
  baseRate: string | number;
  weekendRate: string | number | null;
  minNights: number;
  amenities: string[];
  sortOrder: number;
  _count?: { rooms: number };
};

type Room = {
  id: string;
  number: string;
  floor: number | null;
  status: "VACANT_CLEAN" | "VACANT_DIRTY" | "OCCUPIED" | "MAINTENANCE";
  notes: string | null;
  roomType: RoomType;
  roomTypeId: string;
};

type Guest = {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  idNumber: string | null;
  nationality: string | null;
};

type FolioCharge = {
  id: string;
  type: string;
  amount: string | number;
  description: string;
  voided: boolean;
  chargedAt: string;
  night: string | null;
};

type Folio = {
  id: string;
  status: "OPEN" | "SETTLED" | "VOID";
  openingDeposit: string | number;
  settledTotal: string | number | null;
  settledMethod: string | null;
  charges: FolioCharge[];
};

type Reservation = {
  id: string;
  status: "BOOKED" | "CHECKED_IN" | "CHECKED_OUT" | "CANCELLED" | "NO_SHOW";
  source: string;
  checkInDate: string;
  checkOutDate: string;
  checkedInAt: string | null;
  checkedOutAt: string | null;
  nightlyRate: string | number;
  adults: number;
  children: number;
  specialRequests: string | null;
  internalNotes: string | null;
  stayToken: string | null;
  guest: Guest;
  room: Room;
  folio: Folio | null;
};

type Today = {
  hotel: Hotel | null;
  arrivals: Reservation[];
  departures: Reservation[];
  inHouse: Reservation[];
  occupancy: { occupied: number; total: number };
  revenue?: {
    byType: Record<string, number>;
    collectedByMethod: Record<string, number>;
    totalCollected: number;
    totalPosted: number;
  };
};

type Staff = { id: string; name: string; role: string };

// ───────────────────────────────────────────────
// Helpers
// ───────────────────────────────────────────────

function fmtEGP(n: string | number | null | undefined) {
  const v = Number(n || 0);
  return Math.round(v).toLocaleString("en-EG");
}

function fmtDate(d: string | Date) {
  const dt = typeof d === "string" ? new Date(d) : d;
  return dt.toISOString().slice(0, 10);
}

function todayISO() {
  return fmtDate(new Date());
}

function addDays(iso: string, n: number) {
  const d = new Date(iso);
  d.setUTCDate(d.getUTCDate() + n);
  return fmtDate(d);
}

function folioBalance(folio: Folio | null): number {
  if (!folio) return 0;
  const sum = folio.charges
    .filter((c) => !c.voided)
    .reduce((acc, c) => acc + Number(c.amount), 0);
  return sum - Number(folio.openingDeposit || 0);
}

// ═══════════════════════════════════════════════
// LOGIN GATE
// ═══════════════════════════════════════════════

export default function HotelPage() {
  const [staff, setStaff] = useState<Staff | null>(null);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    try {
      const saved = localStorage.getItem("hotel_staff");
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed.loginAt && Date.now() - parsed.loginAt < 16 * 60 * 60 * 1000) {
          setStaff(parsed);
        } else {
          localStorage.removeItem("hotel_staff");
        }
      }
    } catch {}
    setHydrated(true);
  }, []);

  if (!hydrated) {
    return (
      <div className="min-h-dvh bg-sand-100 flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-sand-300 border-t-amber-600 rounded-full animate-spin" />
      </div>
    );
  }

  if (!staff) {
    return (
      <HotelLogin
        onLogin={(s) => {
          const withTs = { ...s, loginAt: Date.now() };
          localStorage.setItem("hotel_staff", JSON.stringify(withTs));
          setStaff(s);
        }}
      />
    );
  }

  return (
    <HotelDashboard
      staff={staff}
      onLogout={() => {
        localStorage.removeItem("hotel_staff");
        setStaff(null);
      }}
    />
  );
}

function HotelLogin({ onLogin }: { onLogin: (s: Staff) => void }) {
  const [pin, setPin] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const restaurantSlug = process.env.NEXT_PUBLIC_RESTAURANT_SLUG || "neom-dahab";

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch("/api/staff/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin, restaurantId: restaurantSlug }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Login failed");
      // /api/staff/login returns the staff fields flat (id, name,
      // role, restaurantId, …) plus waiterAppEnabled — there's no
      // outer "staff" wrapper here, unlike some other endpoints.
      const role = data.role;
      if (!role) throw new Error("Login response missing role");
      if (!["OWNER", "FRONT_DESK"].includes(role)) {
        throw new Error("Owner or front-desk role required");
      }
      onLogin({ id: data.id, name: data.name, role });
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Login failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-dvh bg-gradient-to-br from-amber-50 to-sand-100 flex items-center justify-center p-4">
      <form
        onSubmit={submit}
        className="bg-white rounded-2xl shadow-xl p-8 w-full max-w-sm"
      >
        <div className="text-center mb-6">
          <div className="text-4xl mb-2">🛏️</div>
          <h1 className="text-2xl font-extrabold text-ink">Hotel Front Desk</h1>
          <p className="text-sm text-ink-soft mt-1">Owner or front-desk PIN</p>
        </div>
        <input
          type="password"
          inputMode="numeric"
          autoFocus
          value={pin}
          onChange={(e) => setPin(e.target.value)}
          placeholder="••••"
          className="w-full px-4 py-3 text-2xl text-center font-extrabold border-2 border-sand-300 rounded-xl focus:outline-none focus:border-amber-500 tracking-widest"
        />
        {err && (
          <div className="mt-3 p-2 bg-status-bad-50 text-status-bad-700 rounded-lg text-sm text-center">
            {err}
          </div>
        )}
        <button
          type="submit"
          disabled={busy || !pin}
          className="w-full mt-4 py-3 bg-amber-600 hover:bg-amber-700 text-white font-extrabold rounded-xl disabled:opacity-50"
        >
          {busy ? "…" : "Enter"}
        </button>
      </form>
    </div>
  );
}

// ═══════════════════════════════════════════════
// MAIN DASHBOARD
// ═══════════════════════════════════════════════

type Tab = "today" | "reservations" | "walkin" | "calendar" | "rooms" | "config";

function HotelDashboard({ staff, onLogout }: { staff: Staff; onLogout: () => void }) {
  const [tab, setTab] = useState<Tab>("today");
  const [hotelExists, setHotelExists] = useState<boolean | null>(null);
  const restaurantSlug = process.env.NEXT_PUBLIC_RESTAURANT_SLUG || "neom-dahab";

  useEffect(() => {
    fetch(`/api/hotel?slug=${restaurantSlug}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => setHotelExists(!!d.hotel))
      .catch(() => setHotelExists(false));
  }, [restaurantSlug]);

  if (hotelExists === null) {
    return (
      <div className="min-h-dvh bg-sand-100 flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-sand-300 border-t-amber-600 rounded-full animate-spin" />
      </div>
    );
  }

  if (!hotelExists) {
    return <HotelSetup staff={staff} onCreated={() => setHotelExists(true)} />;
  }

  return (
    <div className="min-h-dvh bg-sand-50">
      <header className="bg-white border-b border-sand-200 sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="text-2xl">🛏️</span>
            <div>
              <h1 className="text-sm font-extrabold text-ink leading-tight">
                Neom Hotel
              </h1>
              <p className="text-[11px] text-ink-mute">
                {staff.name} · {staff.role}
              </p>
            </div>
          </div>
          <button
            onClick={onLogout}
            className="text-xs font-bold text-ink-soft hover:text-ink"
          >
            Sign out
          </button>
        </div>
        <nav className="max-w-6xl mx-auto px-4 flex gap-1 overflow-x-auto">
          {([
            ["today", "Today"],
            ["walkin", "Walk-in"],
            ["reservations", "Reservations"],
            ["calendar", "Calendar"],
            ["rooms", "Rooms"],
            ["config", "Setup"],
          ] as [Tab, string][]).map(([k, label]) => (
            <button
              key={k}
              onClick={() => setTab(k)}
              className={`px-4 py-3 text-sm font-bold whitespace-nowrap border-b-2 transition ${
                tab === k
                  ? "text-amber-700 border-amber-600"
                  : "text-ink-mute border-transparent hover:text-ink"
              }`}
            >
              {label}
            </button>
          ))}
        </nav>
      </header>

      <main className="max-w-6xl mx-auto px-4 py-6">
        {tab === "today" && <TodayTab staff={staff} />}
        {tab === "walkin" && <WalkInTab staff={staff} />}
        {tab === "reservations" && <ReservationsTab staff={staff} />}
        {tab === "calendar" && <CalendarTab staff={staff} />}
        {tab === "rooms" && <RoomsTab staff={staff} />}
        {tab === "config" && <ConfigTab staff={staff} />}
      </main>
    </div>
  );
}

function HotelSetup({
  staff,
  onCreated,
}: {
  staff: Staff;
  onCreated: () => void;
}) {
  const [name, setName] = useState("Neom Beachfront Hotel");
  const [address, setAddress] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setErr(null);
    try {
      const res = await authedFetch("/api/hotel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, address }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Setup failed");
      }
      onCreated();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Setup failed");
    } finally {
      setBusy(false);
    }
  }

  if (staff.role !== "OWNER") {
    return (
      <div className="min-h-dvh bg-sand-100 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-lg p-8 max-w-md text-center">
          <h2 className="text-lg font-extrabold mb-2">Hotel not yet set up</h2>
          <p className="text-sm text-ink-soft">
            The owner needs to create the hotel record before front-desk staff
            can use this section.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-dvh bg-sand-50 flex items-center justify-center p-4">
      <form
        onSubmit={submit}
        className="bg-white rounded-2xl shadow-lg p-8 w-full max-w-md"
      >
        <h2 className="text-xl font-extrabold mb-1">Set up your hotel</h2>
        <p className="text-sm text-ink-soft mb-6">
          One-time. After this you'll add room types, then individual rooms.
        </p>
        <label className="block text-xs font-bold text-ink-mute mb-1 uppercase tracking-wider">
          Property name
        </label>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          className="w-full px-3 py-2 border border-sand-300 rounded-lg mb-4"
        />
        <label className="block text-xs font-bold text-ink-mute mb-1 uppercase tracking-wider">
          Address (optional)
        </label>
        <input
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          className="w-full px-3 py-2 border border-sand-300 rounded-lg mb-4"
        />
        {err && (
          <div className="p-2 bg-status-bad-50 text-status-bad-700 rounded-lg text-sm mb-4">
            {err}
          </div>
        )}
        <button
          disabled={busy}
          className="w-full py-3 bg-amber-600 hover:bg-amber-700 text-white font-extrabold rounded-xl disabled:opacity-50"
        >
          {busy ? "…" : "Create hotel"}
        </button>
      </form>
    </div>
  );
}

// ═══════════════════════════════════════════════
// TAB: TODAY
// ═══════════════════════════════════════════════

function TodayTab({ staff }: { staff: Staff }) {
  const [data, setData] = useState<Today | null>(null);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    try {
      const res = await authedFetch("/api/hotel/today", { cache: "no-store" });
      const json = await res.json();
      setData(json);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    const t = setInterval(load, 30000);
    return () => clearInterval(t);
  }, []);

  if (loading && !data) {
    return <div className="text-sm text-ink-mute">Loading…</div>;
  }
  if (!data) return null;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Stat label="Arrivals today" value={data.arrivals.length} />
        <Stat label="Departures today" value={data.departures.length} />
        <Stat label="In-house" value={data.inHouse.length} />
        <Stat
          label="Occupancy"
          value={`${data.occupancy.occupied}/${data.occupancy.total}`}
        />
      </div>

      {data.revenue && <RevenuePanel revenue={data.revenue} />}

      <Section title="Arrivals">
        {data.arrivals.length === 0 ? (
          <Empty>No arrivals today.</Empty>
        ) : (
          data.arrivals.map((r) => (
            <ArrivalRow key={r.id} reservation={r} onAction={load} staff={staff} />
          ))
        )}
      </Section>

      <Section title="Departures">
        {data.departures.length === 0 ? (
          <Empty>No departures today.</Empty>
        ) : (
          data.departures.map((r) => (
            <DepartureRow key={r.id} reservation={r} onAction={load} staff={staff} />
          ))
        )}
      </Section>

      <Section title="In-house">
        {data.inHouse.length === 0 ? (
          <Empty>No guests checked in.</Empty>
        ) : (
          data.inHouse.map((r) => (
            <InHouseRow key={r.id} reservation={r} onAction={load} staff={staff} />
          ))
        )}
      </Section>
    </div>
  );
}

function RevenuePanel({
  revenue,
}: {
  revenue: NonNullable<Today["revenue"]>;
}) {
  const order: [string, string][] = [
    ["ROOM_NIGHT", "Room nights"],
    ["FOOD", "Cafe → room"],
    ["ACTIVITY", "Activities → room"],
    ["MINIBAR", "Minibar"],
    ["MISC", "Other"],
  ];
  const methodOrder: [string, string][] = [
    ["CASH", "Cash"],
    ["CARD", "Card"],
    ["INSTAPAY", "InstaPay"],
  ];
  return (
    <section className="bg-white border border-sand-200 rounded-xl p-5 shadow-sm">
      <h2 className="text-sm font-extrabold uppercase tracking-wider text-ink-mute mb-3">
        Revenue today
      </h2>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div>
          <div className="text-[11px] font-extrabold uppercase tracking-wider text-ink-mute mb-2">
            Posted to folios today
          </div>
          {order.map(([k, label]) => {
            const v = revenue.byType[k] || 0;
            if (v === 0) return null;
            return (
              <div
                key={k}
                className="flex items-center justify-between text-sm py-1 border-b border-sand-100 last:border-b-0"
              >
                <span className="text-ink-soft">{label}</span>
                <span className="font-bold tabular-nums">
                  {fmtEGP(v)} EGP
                </span>
              </div>
            );
          })}
          <div className="flex items-center justify-between text-sm pt-2 mt-1 border-t border-sand-300">
            <span className="font-extrabold">Total posted</span>
            <span className="font-extrabold tabular-nums text-amber-800">
              {fmtEGP(revenue.totalPosted)} EGP
            </span>
          </div>
        </div>
        <div>
          <div className="text-[11px] font-extrabold uppercase tracking-wider text-ink-mute mb-2">
            Collected at checkout today
          </div>
          {methodOrder.map(([k, label]) => {
            const v = revenue.collectedByMethod[k] || 0;
            if (v === 0) return null;
            return (
              <div
                key={k}
                className="flex items-center justify-between text-sm py-1 border-b border-sand-100 last:border-b-0"
              >
                <span className="text-ink-soft">{label}</span>
                <span className="font-bold tabular-nums">
                  {fmtEGP(v)} EGP
                </span>
              </div>
            );
          })}
          <div className="flex items-center justify-between text-sm pt-2 mt-1 border-t border-sand-300">
            <span className="font-extrabold">Total collected</span>
            <span className="font-extrabold tabular-nums text-status-good-700">
              {fmtEGP(revenue.totalCollected)} EGP
            </span>
          </div>
        </div>
      </div>
      <p className="text-[11px] text-ink-mute mt-3">
        Posted = charges added to folios today. Collected = folios actually
        settled today (different days because most stays span several nights
        before the cash arrives).
      </p>
    </section>
  );
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="bg-white border border-sand-200 rounded-xl p-4 shadow-sm">
      <div className="text-[11px] font-extrabold uppercase tracking-wider text-ink-mute">
        {label}
      </div>
      <div className="text-3xl font-extrabold text-ink mt-1">{value}</div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="text-sm font-extrabold uppercase tracking-wider text-ink-mute mb-2">
        {title}
      </h2>
      <div className="space-y-2">{children}</div>
    </section>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-sm text-ink-mute py-3 px-4 bg-white border border-sand-200 rounded-xl">
      {children}
    </div>
  );
}

function ArrivalRow({
  reservation,
  onAction,
  staff,
}: {
  reservation: Reservation;
  onAction: () => void;
  staff: Staff;
}) {
  const [busy, setBusy] = useState(false);
  async function checkIn() {
    if (busy) return;
    setBusy(true);
    try {
      const res = await authedFetch(
        `/api/hotel/reservations/${reservation.id}/checkin`,
        { method: "POST" }
      );
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        alert(d.error || "Check-in failed");
      }
      onAction();
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="bg-white border border-sand-200 rounded-xl p-4 flex flex-wrap items-center gap-3">
      <div className="flex-1 min-w-[180px]">
        <div className="font-extrabold text-ink">{reservation.guest.name}</div>
        <div className="text-xs text-ink-soft">
          Room {reservation.room.number} · {reservation.room.roomType.name} ·{" "}
          {fmtDate(reservation.checkInDate)} → {fmtDate(reservation.checkOutDate)}
        </div>
      </div>
      <button
        disabled={busy}
        onClick={checkIn}
        className="px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white font-bold rounded-lg text-sm disabled:opacity-50"
      >
        Check in
      </button>
    </div>
  );
}

function DepartureRow({
  reservation,
  onAction,
  staff,
}: {
  reservation: Reservation;
  onAction: () => void;
  staff: Staff;
}) {
  const [openCheckout, setOpenCheckout] = useState(false);
  return (
    <>
      <div className="bg-white border border-sand-200 rounded-xl p-4 flex flex-wrap items-center gap-3">
        <div className="flex-1 min-w-[180px]">
          <div className="font-extrabold text-ink">{reservation.guest.name}</div>
          <div className="text-xs text-ink-soft">
            Room {reservation.room.number} · folio balance{" "}
            <strong>{fmtEGP(folioBalance(reservation.folio))} EGP</strong>
          </div>
        </div>
        <button
          onClick={() => setOpenCheckout(true)}
          className="px-4 py-2 bg-status-good-600 hover:bg-status-good-700 text-white font-bold rounded-lg text-sm"
        >
          Checkout & settle
        </button>
      </div>
      {openCheckout && (
        <CheckoutModal
          reservation={reservation}
          onClose={() => setOpenCheckout(false)}
          onDone={() => {
            setOpenCheckout(false);
            onAction();
          }}
        />
      )}
    </>
  );
}

function InHouseRow({
  reservation,
  onAction,
  staff,
}: {
  reservation: Reservation;
  onAction: () => void;
  staff: Staff;
}) {
  const [openDetail, setOpenDetail] = useState(false);
  return (
    <>
      <button
        onClick={() => setOpenDetail(true)}
        className="w-full text-left bg-white border border-sand-200 hover:border-amber-400 transition rounded-xl p-4 flex flex-wrap items-center gap-3"
      >
        <div className="flex-1 min-w-[180px]">
          <div className="font-extrabold text-ink">{reservation.guest.name}</div>
          <div className="text-xs text-ink-soft">
            Room {reservation.room.number} · until{" "}
            {fmtDate(reservation.checkOutDate)} · folio{" "}
            <strong>{fmtEGP(folioBalance(reservation.folio))} EGP</strong>
          </div>
        </div>
        <span className="text-xs font-bold text-amber-700">Open →</span>
      </button>
      {openDetail && (
        <ReservationDetailModal
          reservationId={reservation.id}
          onClose={() => setOpenDetail(false)}
          onChange={onAction}
        />
      )}
    </>
  );
}

// ═══════════════════════════════════════════════
// CHECKOUT + FOLIO MODALS
// ═══════════════════════════════════════════════

function CheckoutModal({
  reservation,
  onClose,
  onDone,
}: {
  reservation: Reservation;
  onClose: () => void;
  onDone: () => void;
}) {
  const [method, setMethod] = useState<string>("CASH");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const balance = folioBalance(reservation.folio);

  async function submit() {
    if (busy) return;
    setBusy(true);
    setErr(null);
    try {
      const res = await authedFetch(
        `/api/hotel/reservations/${reservation.id}/checkout`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ paymentMethod: method }),
        }
      );
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || "Checkout failed");
      }
      onDone();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Checkout failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal onClose={onClose} title={`Checkout — Room ${reservation.room.number}`}>
      <div className="space-y-4">
        <div className="bg-sand-50 rounded-lg p-3">
          <div className="text-xs text-ink-mute">Guest</div>
          <div className="font-extrabold">{reservation.guest.name}</div>
        </div>
        <div className="bg-sand-50 rounded-lg p-3">
          <div className="text-xs text-ink-mute">Folio balance</div>
          <div className="text-3xl font-extrabold text-status-good-700">
            {fmtEGP(balance)} EGP
          </div>
        </div>
        <div>
          <div className="text-xs font-bold text-ink-mute mb-2 uppercase tracking-wider">
            Payment method
          </div>
          <div className="grid grid-cols-3 gap-2">
            {[
              ["CASH", "💵 Cash"],
              ["CARD", "💳 Card"],
              ["INSTAPAY", "📱 InstaPay"],
            ].map(([k, label]) => (
              <button
                key={k}
                onClick={() => setMethod(k)}
                className={`py-3 rounded-lg font-bold text-sm border-2 ${
                  method === k
                    ? "bg-amber-50 border-amber-600 text-amber-700"
                    : "bg-white border-sand-300 text-ink-soft"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        {err && (
          <div className="p-2 bg-status-bad-50 text-status-bad-700 rounded-lg text-sm">
            {err}
          </div>
        )}
        <div className="flex gap-2 justify-end pt-2">
          <button
            onClick={onClose}
            disabled={busy}
            className="px-4 py-2 text-sm font-bold text-ink-soft hover:bg-sand-100 rounded-lg disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={busy}
            className="px-5 py-2 bg-status-good-600 hover:bg-status-good-700 text-white font-extrabold rounded-lg disabled:opacity-50"
          >
            {busy ? "…" : `Settle ${fmtEGP(balance)} EGP`}
          </button>
        </div>
      </div>
    </Modal>
  );
}

/**
 * Reservation detail modal — single screen for everything you can do
 * to one booking. Replaces the older FolioModal which only showed
 * charges. Status drives which actions are available; the modal
 * reloads its own copy of the reservation after each action so the
 * UI stays consistent without depending on the parent re-fetching.
 */
function ReservationDetailModal({
  reservationId,
  onClose,
  onChange,
}: {
  reservationId: string;
  onClose: () => void;
  /** Called whenever the reservation state changes (status, folio,
   *  edit) so the parent (Today / list) can refresh its data. */
  onChange: () => void;
}) {
  const [reservation, setReservation] = useState<Reservation | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [confirmingCancel, setConfirmingCancel] = useState(false);
  const [extending, setExtending] = useState(false);
  const [showAddCharge, setShowAddCharge] = useState(false);
  const [showCheckout, setShowCheckout] = useState(false);
  const [busy, setBusy] = useState(false);

  async function reload() {
    setLoading(true);
    try {
      const res = await authedFetch(
        `/api/hotel/reservations/${reservationId}`,
        { cache: "no-store" }
      );
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Failed to load");
      setReservation(d.reservation);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reservationId]);

  async function checkIn() {
    if (busy) return;
    setBusy(true);
    setErr(null);
    try {
      const res = await authedFetch(
        `/api/hotel/reservations/${reservationId}/checkin`,
        { method: "POST" }
      );
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || "Check-in failed");
      }
      await reload();
      onChange();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Check-in failed");
    } finally {
      setBusy(false);
    }
  }

  async function noShow() {
    if (busy) return;
    if (!confirm("Mark this reservation as a no-show? Folio will be voided.")) return;
    setBusy(true);
    setErr(null);
    try {
      const res = await authedFetch(`/api/hotel/reservations/${reservationId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "no_show" }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || "Failed");
      }
      await reload();
      onChange();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  if (loading && !reservation) {
    return (
      <Modal onClose={onClose} title="Reservation" wide>
        <div className="text-sm text-ink-mute py-12 text-center">Loading…</div>
      </Modal>
    );
  }
  if (!reservation) {
    return (
      <Modal onClose={onClose} title="Reservation" wide>
        <div className="text-sm text-status-bad-700 py-6">{err || "Not found"}</div>
      </Modal>
    );
  }

  const balance = folioBalance(reservation.folio);
  const status = reservation.status;
  const isFinal = status === "CHECKED_OUT" || status === "CANCELLED" || status === "NO_SHOW";

  return (
    <Modal
      onClose={onClose}
      title={`${reservation.guest.name} · Room ${reservation.room.number}`}
      wide
    >
      <div className="space-y-5">
        {/* Status + key facts */}
        <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-sand-200">
          <StatusBadge status={status} />
          <div className="text-xs text-ink-mute">
            {fmtDate(reservation.checkInDate)} → {fmtDate(reservation.checkOutDate)} ·{" "}
            {reservation.adults} adult{reservation.adults === 1 ? "" : "s"}
            {reservation.children > 0 && `, ${reservation.children} kid${reservation.children === 1 ? "" : "s"}`}
          </div>
        </div>

        {/* Guest info */}
        <section>
          <div className="text-[11px] font-extrabold uppercase tracking-wider text-ink-mute mb-1">
            Guest
          </div>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
            <div>
              <span className="text-ink-mute">Name:</span>{" "}
              <strong>{reservation.guest.name}</strong>
            </div>
            <div>
              <span className="text-ink-mute">Phone:</span>{" "}
              {reservation.guest.phone || "—"}
            </div>
            <div>
              <span className="text-ink-mute">ID:</span>{" "}
              {reservation.guest.idNumber || "—"}
            </div>
            <div>
              <span className="text-ink-mute">Nationality:</span>{" "}
              {reservation.guest.nationality || "—"}
            </div>
          </div>
        </section>

        {/* Guest stay link — only after check-in */}
        {reservation.stayToken && (
          <section className="bg-amber-50 border border-amber-200 rounded-lg p-3">
            <div className="text-[11px] font-extrabold uppercase tracking-wider text-amber-700 mb-1">
              Guest folio link
            </div>
            <div className="flex items-center gap-2">
              <code className="flex-1 text-xs bg-white px-2 py-1 rounded border border-amber-200 truncate">
                {typeof window !== "undefined" ? window.location.origin : ""}/stay/{reservation.stayToken}
              </code>
              <button
                onClick={() => {
                  const url = `${window.location.origin}/stay/${reservation.stayToken}`;
                  navigator.clipboard.writeText(url);
                }}
                className="px-3 py-1.5 bg-amber-600 hover:bg-amber-700 text-white font-bold rounded text-xs"
              >
                Copy
              </button>
            </div>
            <p className="text-[11px] text-amber-700 mt-1">
              Share this URL (or its QR) with the guest to let them watch
              their folio update in real time.
            </p>
          </section>
        )}

        {/* Stay info — editable */}
        <section>
          <div className="flex items-center justify-between mb-1">
            <div className="text-[11px] font-extrabold uppercase tracking-wider text-ink-mute">
              Stay
            </div>
            {!isFinal && !editing && (
              <button
                onClick={() => setEditing(true)}
                className="text-[11px] font-bold text-amber-700 hover:underline"
              >
                Edit
              </button>
            )}
          </div>
          {!editing ? (
            <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
              <div>
                <span className="text-ink-mute">Room:</span>{" "}
                <strong>
                  {reservation.room.number} ({reservation.room.roomType.name})
                </strong>
              </div>
              <div>
                <span className="text-ink-mute">Rate:</span>{" "}
                <strong>{fmtEGP(reservation.nightlyRate)} EGP/night</strong>
              </div>
              {reservation.specialRequests && (
                <div className="col-span-2">
                  <span className="text-ink-mute">Special requests:</span>{" "}
                  {reservation.specialRequests}
                </div>
              )}
              {reservation.internalNotes && (
                <div className="col-span-2">
                  <span className="text-ink-mute">Internal notes:</span>{" "}
                  <em>{reservation.internalNotes}</em>
                </div>
              )}
            </div>
          ) : (
            <EditStayForm
              reservation={reservation}
              onCancel={() => setEditing(false)}
              onSaved={async () => {
                setEditing(false);
                await reload();
                onChange();
              }}
            />
          )}
        </section>

        {/* Folio */}
        <section>
          <div className="flex items-center justify-between mb-2">
            <div className="text-[11px] font-extrabold uppercase tracking-wider text-ink-mute">
              Folio
            </div>
            <div className="text-lg font-extrabold text-amber-800 tabular-nums">
              {fmtEGP(balance)} EGP
            </div>
          </div>
          <div className="border border-sand-200 rounded-lg overflow-hidden">
            <div className="grid grid-cols-[1fr_auto_auto_auto] gap-2 px-3 py-2 bg-sand-50 text-[11px] font-extrabold uppercase tracking-wider text-ink-mute">
              <div>Description</div>
              <div>Type</div>
              <div className="text-right">Amount</div>
              <div></div>
            </div>
            {(reservation.folio?.charges || []).length === 0 ? (
              <div className="px-3 py-4 text-sm text-ink-mute text-center">
                No charges yet.
              </div>
            ) : (
              reservation.folio!.charges.map((c) => (
                <div
                  key={c.id}
                  className={`grid grid-cols-[1fr_auto_auto_auto] gap-2 px-3 py-2 text-sm border-t border-sand-200 ${
                    c.voided ? "line-through text-ink-mute" : ""
                  }`}
                >
                  <div>{c.description}</div>
                  <div className="text-xs text-ink-mute">{c.type}</div>
                  <div className="text-right font-bold tabular-nums">
                    {fmtEGP(c.amount)}
                  </div>
                  <div>
                    {!c.voided && reservation.folio?.status === "OPEN" && (
                      <button
                        onClick={async () => {
                          const reason = prompt("Why void this charge?");
                          if (!reason) return;
                          const res = await authedFetch(
                            `/api/hotel/folios/${reservation.folio!.id}/charge`,
                            {
                              method: "DELETE",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({ chargeId: c.id, reason }),
                            }
                          );
                          if (res.ok) {
                            await reload();
                            onChange();
                          } else {
                            alert("Void failed");
                          }
                        }}
                        className="text-[11px] font-bold text-status-bad-700 hover:underline"
                      >
                        Void
                      </button>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
          {reservation.folio?.status === "OPEN" && !isFinal && (
            <button
              onClick={() => setShowAddCharge(true)}
              className="mt-2 px-3 py-1.5 bg-sand-100 hover:bg-sand-200 text-ink font-bold rounded-lg text-xs"
            >
              + Add charge (minibar / misc)
            </button>
          )}
        </section>

        {err && (
          <div className="p-2 bg-status-bad-50 text-status-bad-700 rounded-lg text-sm">
            {err}
          </div>
        )}

        {/* Action buttons by status */}
        <div className="flex flex-wrap gap-2 justify-end pt-3 border-t border-sand-200">
          {status === "BOOKED" && (
            <>
              <button
                disabled={busy}
                onClick={() => setConfirmingCancel(true)}
                className="px-3 py-2 text-xs font-bold text-status-bad-700 hover:bg-status-bad-50 rounded-lg disabled:opacity-50"
              >
                Cancel booking
              </button>
              <button
                disabled={busy}
                onClick={noShow}
                className="px-3 py-2 text-xs font-bold text-ink-soft hover:bg-sand-100 rounded-lg disabled:opacity-50"
              >
                Mark no-show
              </button>
              <button
                disabled={busy}
                onClick={checkIn}
                className="px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white font-extrabold rounded-lg text-sm disabled:opacity-50"
              >
                {busy ? "…" : "Check in"}
              </button>
            </>
          )}
          {status === "CHECKED_IN" && (
            <>
              <button
                disabled={busy}
                onClick={() => setExtending(true)}
                className="px-3 py-2 text-xs font-bold text-ink-soft hover:bg-sand-100 rounded-lg disabled:opacity-50"
              >
                Extend stay
              </button>
              <button
                disabled={busy}
                onClick={() => setShowCheckout(true)}
                className="px-4 py-2 bg-status-good-600 hover:bg-status-good-700 text-white font-extrabold rounded-lg text-sm disabled:opacity-50"
              >
                Check out & settle
              </button>
            </>
          )}
          <button
            onClick={onClose}
            className="px-3 py-2 text-xs font-bold text-ink-soft hover:bg-sand-100 rounded-lg"
          >
            Close
          </button>
        </div>

        {/* Sub-modals */}
        {showAddCharge && reservation.folio && (
          <AddChargeModal
            folioId={reservation.folio.id}
            onClose={() => setShowAddCharge(false)}
            onAdded={async () => {
              setShowAddCharge(false);
              await reload();
              onChange();
            }}
          />
        )}
        {showCheckout && (
          <CheckoutModal
            reservation={reservation}
            onClose={() => setShowCheckout(false)}
            onDone={async () => {
              setShowCheckout(false);
              await reload();
              onChange();
            }}
          />
        )}
        {confirmingCancel && (
          <CancelConfirmModal
            reservationId={reservationId}
            onClose={() => setConfirmingCancel(false)}
            onCancelled={async () => {
              setConfirmingCancel(false);
              await reload();
              onChange();
            }}
          />
        )}
        {extending && (
          <ExtendModal
            reservation={reservation}
            onClose={() => setExtending(false)}
            onExtended={async () => {
              setExtending(false);
              await reload();
              onChange();
            }}
          />
        )}
      </div>
    </Modal>
  );
}

/** Inline edit form for a reservation — non-destructive fields. */
function EditStayForm({
  reservation,
  onCancel,
  onSaved,
}: {
  reservation: Reservation;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const [adults, setAdults] = useState(reservation.adults);
  const [childCount, setChildCount] = useState(reservation.children);
  const [nightlyRate, setNightlyRate] = useState(String(reservation.nightlyRate));
  const [specialRequests, setSpecialRequests] = useState(
    reservation.specialRequests || ""
  );
  const [internalNotes, setInternalNotes] = useState(
    reservation.internalNotes || ""
  );
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save() {
    if (busy) return;
    const rate = Number(nightlyRate);
    if (!Number.isFinite(rate) || rate < 0) {
      setErr("Rate must be a number");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const res = await authedFetch(`/api/hotel/reservations/${reservation.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "edit",
          adults,
          children: childCount,
          nightlyRate: rate,
          specialRequests,
          internalNotes,
        }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || "Save failed");
      }
      onSaved();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Save failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2 bg-sand-50 rounded-lg p-3">
      <div className="grid grid-cols-3 gap-2">
        <label className="block">
          <div className="text-[10px] font-bold uppercase tracking-wider text-ink-mute">
            Adults
          </div>
          <input
            type="number"
            min={1}
            value={adults}
            onChange={(e) => setAdults(Number(e.target.value) || 1)}
            className="w-full px-2 py-1 border border-sand-300 rounded text-sm"
          />
        </label>
        <label className="block">
          <div className="text-[10px] font-bold uppercase tracking-wider text-ink-mute">
            Children
          </div>
          <input
            type="number"
            min={0}
            value={childCount}
            onChange={(e) => setChildCount(Number(e.target.value) || 0)}
            className="w-full px-2 py-1 border border-sand-300 rounded text-sm"
          />
        </label>
        <label className="block">
          <div className="text-[10px] font-bold uppercase tracking-wider text-ink-mute">
            Rate (EGP/night)
          </div>
          <input
            type="number"
            step="0.01"
            value={nightlyRate}
            onChange={(e) => setNightlyRate(e.target.value)}
            className="w-full px-2 py-1 border border-sand-300 rounded text-sm"
          />
        </label>
      </div>
      <label className="block">
        <div className="text-[10px] font-bold uppercase tracking-wider text-ink-mute">
          Special requests (visible to staff and on receipts)
        </div>
        <textarea
          value={specialRequests}
          onChange={(e) => setSpecialRequests(e.target.value)}
          rows={2}
          className="w-full px-2 py-1 border border-sand-300 rounded text-sm"
        />
      </label>
      <label className="block">
        <div className="text-[10px] font-bold uppercase tracking-wider text-ink-mute">
          Internal notes (staff-only)
        </div>
        <textarea
          value={internalNotes}
          onChange={(e) => setInternalNotes(e.target.value)}
          rows={2}
          className="w-full px-2 py-1 border border-sand-300 rounded text-sm"
        />
      </label>
      {err && (
        <div className="p-2 bg-status-bad-50 text-status-bad-700 rounded text-xs">
          {err}
        </div>
      )}
      <div className="flex gap-2 justify-end">
        <button
          onClick={onCancel}
          disabled={busy}
          className="px-3 py-1.5 text-xs font-bold text-ink-soft hover:bg-sand-100 rounded"
        >
          Cancel
        </button>
        <button
          onClick={save}
          disabled={busy}
          className="px-3 py-1.5 bg-amber-600 hover:bg-amber-700 text-white font-extrabold rounded text-xs disabled:opacity-50"
        >
          {busy ? "…" : "Save"}
        </button>
      </div>
    </div>
  );
}

function CancelConfirmModal({
  reservationId,
  onClose,
  onCancelled,
}: {
  reservationId: string;
  onClose: () => void;
  onCancelled: () => void;
}) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit() {
    if (busy) return;
    setBusy(true);
    setErr(null);
    try {
      const res = await authedFetch(`/api/hotel/reservations/${reservationId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "cancel", reason }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || "Cancel failed");
      }
      onCancelled();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Cancel failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal onClose={onClose} title="Cancel reservation">
      <div className="space-y-3">
        <p className="text-sm text-ink-soft">
          The reservation will be cancelled and the folio voided. Charges
          posted before this point are preserved in the audit trail.
        </p>
        <input
          autoFocus
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Reason (optional but recommended)"
          className="w-full px-3 py-2 border border-sand-300 rounded-lg"
        />
        {err && (
          <div className="p-2 bg-status-bad-50 text-status-bad-700 rounded-lg text-sm">
            {err}
          </div>
        )}
        <div className="flex gap-2 justify-end">
          <button
            onClick={onClose}
            disabled={busy}
            className="px-4 py-2 text-sm font-bold text-ink-soft hover:bg-sand-100 rounded-lg disabled:opacity-50"
          >
            Keep
          </button>
          <button
            onClick={submit}
            disabled={busy}
            className="px-4 py-2 bg-status-bad-600 hover:bg-status-bad-700 text-white font-extrabold rounded-lg text-sm disabled:opacity-50"
          >
            {busy ? "…" : "Cancel reservation"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

/**
 * Extend-stay modal. Used when a guest already CHECKED_IN wants to
 * push their checkout date out. Calls the "extend" PATCH action AND
 * posts ROOM_NIGHT charges for each newly added night so the folio
 * reflects the extension immediately.
 */
function ExtendModal({
  reservation,
  onClose,
  onExtended,
}: {
  reservation: Reservation;
  onClose: () => void;
  onExtended: () => void;
}) {
  const [newCheckOut, setNewCheckOut] = useState(
    addDays(fmtDate(reservation.checkOutDate), 1)
  );
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit() {
    if (busy) return;
    setBusy(true);
    setErr(null);
    try {
      // Server-side: PATCH with action=extend updates the checkout
      // date AND posts ROOM_NIGHT charges for each added night in a
      // single transaction. We don't need to post charges separately.
      const res = await authedFetch(`/api/hotel/reservations/${reservation.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "extend", checkOutDate: newCheckOut }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || "Extend failed");
      }
      onExtended();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Extend failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal onClose={onClose} title="Extend stay">
      <div className="space-y-3">
        <p className="text-sm text-ink-soft">
          Current checkout: <strong>{fmtDate(reservation.checkOutDate)}</strong>.
          Pick the new checkout date — extra nights will be added to the folio
          at the same nightly rate.
        </p>
        <input
          type="date"
          value={newCheckOut}
          min={addDays(fmtDate(reservation.checkOutDate), 1)}
          onChange={(e) => setNewCheckOut(e.target.value)}
          className="w-full px-3 py-2 border border-sand-300 rounded-lg"
        />
        {err && (
          <div className="p-2 bg-status-bad-50 text-status-bad-700 rounded-lg text-sm">
            {err}
          </div>
        )}
        <div className="flex gap-2 justify-end">
          <button
            onClick={onClose}
            disabled={busy}
            className="px-4 py-2 text-sm font-bold text-ink-soft hover:bg-sand-100 rounded-lg"
          >
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={busy}
            className="px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white font-extrabold rounded-lg text-sm disabled:opacity-50"
          >
            {busy ? "…" : "Extend"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

function AddChargeModal({
  folioId,
  onClose,
  onAdded,
}: {
  folioId: string;
  onClose: () => void;
  onAdded: () => void;
}) {
  const [type, setType] = useState("MINIBAR");
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit() {
    if (busy) return;
    const amt = Number(amount);
    if (!Number.isFinite(amt) || amt <= 0) {
      setErr("Amount must be > 0");
      return;
    }
    if (!description.trim()) {
      setErr("Description required");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const res = await authedFetch(`/api/hotel/folios/${folioId}/charge`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type, amount: amt, description: description.trim() }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || "Failed");
      }
      onAdded();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal onClose={onClose} title="Add charge">
      <div className="space-y-3">
        <select
          value={type}
          onChange={(e) => setType(e.target.value)}
          className="w-full px-3 py-2 border border-sand-300 rounded-lg"
        >
          <option value="MINIBAR">Minibar</option>
          <option value="MISC">Other (misc)</option>
          <option value="ACTIVITY">Activity</option>
          <option value="FOOD">Food</option>
        </select>
        <input
          type="number"
          step="0.01"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="Amount in EGP"
          className="w-full px-3 py-2 border border-sand-300 rounded-lg"
        />
        <input
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Description (e.g. Coke from minibar)"
          className="w-full px-3 py-2 border border-sand-300 rounded-lg"
        />
        {err && (
          <div className="p-2 bg-status-bad-50 text-status-bad-700 rounded-lg text-sm">
            {err}
          </div>
        )}
        <div className="flex gap-2 justify-end">
          <button
            onClick={onClose}
            disabled={busy}
            className="px-4 py-2 text-sm font-bold text-ink-soft hover:bg-sand-100 rounded-lg disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={busy}
            className="px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white font-extrabold rounded-lg text-sm disabled:opacity-50"
          >
            {busy ? "…" : "Add"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

// ═══════════════════════════════════════════════
// TAB: RESERVATIONS
// ═══════════════════════════════════════════════

function ReservationsTab({ staff }: { staff: Staff }) {
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [showNew, setShowNew] = useState(false);
  const [filter, setFilter] = useState<string>("all");
  const [loading, setLoading] = useState(true);
  const [openId, setOpenId] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try {
      const res = await authedFetch(`/api/hotel/reservations`, { cache: "no-store" });
      const d = await res.json();
      setReservations(d.reservations || []);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    load();
  }, []);

  const filtered = useMemo(() => {
    if (filter === "all") return reservations;
    return reservations.filter((r) => r.status === filter);
  }, [reservations, filter]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-1">
          {[
            ["all", "All"],
            ["BOOKED", "Booked"],
            ["CHECKED_IN", "In-house"],
            ["CHECKED_OUT", "Past"],
            ["CANCELLED", "Cancelled"],
          ].map(([k, label]) => (
            <button
              key={k}
              onClick={() => setFilter(k)}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold ${
                filter === k
                  ? "bg-amber-600 text-white"
                  : "bg-white border border-sand-300 text-ink-soft"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <button
          onClick={() => setShowNew(true)}
          className="px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white font-extrabold rounded-lg text-sm"
        >
          + New booking
        </button>
      </div>

      {loading && reservations.length === 0 ? (
        <div className="text-sm text-ink-mute">Loading…</div>
      ) : filtered.length === 0 ? (
        <Empty>No reservations match.</Empty>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full bg-white border border-sand-200 rounded-xl overflow-hidden text-sm">
            <thead className="bg-sand-50 text-[11px] font-extrabold uppercase tracking-wider text-ink-mute">
              <tr>
                <th className="text-left px-3 py-2">Guest</th>
                <th className="text-left px-3 py-2">Room</th>
                <th className="text-left px-3 py-2">Dates</th>
                <th className="text-left px-3 py-2">Status</th>
                <th className="text-right px-3 py-2">Folio</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr
                  key={r.id}
                  onClick={() => setOpenId(r.id)}
                  className="border-t border-sand-200 hover:bg-sand-50 cursor-pointer"
                >
                  <td className="px-3 py-2">
                    <div className="font-bold text-ink">{r.guest.name}</div>
                    <div className="text-[11px] text-ink-mute">
                      {r.guest.phone || ""}
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    <div className="font-bold">{r.room.number}</div>
                    <div className="text-[11px] text-ink-mute">{r.room.roomType.name}</div>
                  </td>
                  <td className="px-3 py-2 text-xs">
                    {fmtDate(r.checkInDate)} → {fmtDate(r.checkOutDate)}
                  </td>
                  <td className="px-3 py-2">
                    <StatusBadge status={r.status} />
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums font-bold">
                    {fmtEGP(folioBalance(r.folio))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showNew && (
        <NewBookingModal
          onClose={() => setShowNew(false)}
          onCreated={() => {
            setShowNew(false);
            load();
          }}
        />
      )}
      {openId && (
        <ReservationDetailModal
          reservationId={openId}
          onClose={() => setOpenId(null)}
          onChange={load}
        />
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, [string, string]> = {
    BOOKED: ["bg-ocean-100 text-ocean-700", "Booked"],
    CHECKED_IN: ["bg-status-good-100 text-status-good-700", "In-house"],
    CHECKED_OUT: ["bg-sand-100 text-ink-mute", "Past"],
    CANCELLED: ["bg-status-bad-100 text-status-bad-700", "Cancelled"],
    NO_SHOW: ["bg-status-bad-100 text-status-bad-700", "No-show"],
  };
  const [classes, label] = map[status] || ["bg-sand-100 text-ink-mute", status];
  return (
    <span
      className={`inline-block px-2 py-0.5 rounded text-[10px] font-extrabold uppercase tracking-wider ${classes}`}
    >
      {label}
    </span>
  );
}

function NewBookingModal({
  onClose,
  onCreated,
  prefill,
}: {
  onClose: () => void;
  onCreated: () => void;
  /** When opened from the calendar's empty-cell click, the room and
   *  dates are already known. We skip the dates and room-pick steps
   *  and let the user just pick the guest. */
  prefill?: { room: Room; checkIn: string; checkOut: string };
}) {
  const [step, setStep] = useState<"guest" | "dates" | "room">("guest");
  const [guest, setGuest] = useState<Guest | null>(null);
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<Guest[]>([]);
  const [newGuestMode, setNewGuestMode] = useState(false);
  const [newGuestForm, setNewGuestForm] = useState({
    name: "",
    phone: "",
    nationality: "",
  });

  const [checkIn, setCheckIn] = useState(prefill?.checkIn || todayISO());
  const [checkOut, setCheckOut] = useState(
    prefill?.checkOut || addDays(todayISO(), 1)
  );
  const [adults, setAdults] = useState(2);
  const [children, setChildren] = useState(0);

  const [availableRooms, setAvailableRooms] = useState<Room[]>([]);
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Search guests as user types
  useEffect(() => {
    if (newGuestMode || step !== "guest") return;
    const q = search.trim();
    const ctrl = new AbortController();
    authedFetch(`/api/hotel/guests?q=${encodeURIComponent(q)}`, {
      cache: "no-store",
      signal: ctrl.signal,
    })
      .then((r) => r.json())
      .then((d) => setResults(d.guests || []))
      .catch(() => {});
    return () => ctrl.abort();
  }, [search, newGuestMode, step]);

  async function createGuest() {
    if (!newGuestForm.name.trim()) {
      setErr("Guest name required");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const res = await authedFetch("/api/hotel/guests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(newGuestForm),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Failed");
      setGuest(d.guest);
      // Prefill (calendar): room + dates already known; create the
      // reservation directly. Otherwise: walk through dates → rooms.
      if (prefill) {
        await createReservation(
          prefill.room.id,
          Number(prefill.room.roomType.baseRate),
          d.guest.id
        );
      } else {
        setStep("dates");
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  async function loadAvailability() {
    setPicking(true);
    setErr(null);
    try {
      const res = await authedFetch(
        `/api/hotel/availability?from=${checkIn}&to=${checkOut}`,
        { cache: "no-store" }
      );
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Failed");
      setAvailableRooms(d.rooms || []);
      setStep("room");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed");
    } finally {
      setPicking(false);
    }
  }

  async function createReservation(
    roomId: string,
    nightlyRate: number,
    guestIdOverride?: string
  ) {
    const gid = guestIdOverride ?? guest?.id;
    if (!gid) return;
    setBusy(true);
    setErr(null);
    try {
      const res = await authedFetch("/api/hotel/reservations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          guestId: gid,
          roomId,
          checkInDate: checkIn,
          checkOutDate: checkOut,
          nightlyRate,
          adults,
          children,
        }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Failed");
      onCreated();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      onClose={onClose}
      title={
        prefill
          ? `New booking · Room ${prefill.room.number} · ${prefill.checkIn}`
          : "New booking"
      }
      wide
    >
      <div className="space-y-4">
        {!prefill && (
          <Stepper
            steps={[
              ["guest", "Guest"],
              ["dates", "Dates"],
              ["room", "Room"],
            ]}
            current={step}
          />
        )}
        {prefill && (
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm">
            Booking <strong>Room {prefill.room.number}</strong> ({prefill.room.roomType.name}) ·{" "}
            <strong>{prefill.checkIn}</strong> → <strong>{prefill.checkOut}</strong> ·{" "}
            {fmtEGP(prefill.room.roomType.baseRate)} EGP/night.
            <br />
            Pick or add a guest below.
          </div>
        )}

        {step === "guest" && !newGuestMode && (
          <div>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by name, phone, ID…"
              className="w-full px-3 py-2 border border-sand-300 rounded-lg mb-3"
              autoFocus
            />
            <div className="max-h-72 overflow-y-auto border border-sand-200 rounded-lg">
              {results.length === 0 ? (
                <div className="text-sm text-ink-mute text-center py-8">
                  No matches. Add a new guest →
                </div>
              ) : (
                results.map((g) => (
                  <button
                    key={g.id}
                    onClick={() => {
                      setGuest(g);
                      // Calendar prefill path: room + dates known, so
                      // create the reservation directly. Default path:
                      // guest is just the start of a 3-step flow.
                      if (prefill) {
                        createReservation(
                          prefill.room.id,
                          Number(prefill.room.roomType.baseRate),
                          g.id
                        );
                      } else {
                        setStep("dates");
                      }
                    }}
                    className="w-full text-left px-3 py-2 hover:bg-sand-50 border-b border-sand-100 last:border-b-0"
                  >
                    <div className="font-bold">{g.name}</div>
                    <div className="text-xs text-ink-mute">
                      {g.phone || g.idNumber || g.email || "—"}
                    </div>
                  </button>
                ))
              )}
            </div>
            <button
              onClick={() => setNewGuestMode(true)}
              className="mt-3 w-full px-3 py-2 bg-sand-100 hover:bg-sand-200 text-ink font-bold rounded-lg text-sm"
            >
              + Add new guest
            </button>
          </div>
        )}

        {step === "guest" && newGuestMode && (
          <div className="space-y-3">
            <input
              value={newGuestForm.name}
              onChange={(e) =>
                setNewGuestForm({ ...newGuestForm, name: e.target.value })
              }
              placeholder="Full name"
              className="w-full px-3 py-2 border border-sand-300 rounded-lg"
              autoFocus
            />
            <input
              value={newGuestForm.phone}
              onChange={(e) =>
                setNewGuestForm({ ...newGuestForm, phone: e.target.value })
              }
              placeholder="Phone"
              className="w-full px-3 py-2 border border-sand-300 rounded-lg"
            />
            <input
              value={newGuestForm.nationality}
              onChange={(e) =>
                setNewGuestForm({ ...newGuestForm, nationality: e.target.value })
              }
              placeholder="Nationality (optional)"
              className="w-full px-3 py-2 border border-sand-300 rounded-lg"
            />
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setNewGuestMode(false)}
                disabled={busy}
                className="px-4 py-2 text-sm font-bold text-ink-soft hover:bg-sand-100 rounded-lg"
              >
                Back to search
              </button>
              <button
                onClick={createGuest}
                disabled={busy}
                className="px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white font-extrabold rounded-lg text-sm disabled:opacity-50"
              >
                {busy ? "…" : "Create & continue"}
              </button>
            </div>
          </div>
        )}

        {step === "dates" && guest && (
          <div className="space-y-3">
            <div className="bg-sand-50 rounded-lg p-3 text-sm">
              Booking for: <strong>{guest.name}</strong>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <div className="text-xs font-bold uppercase tracking-wider text-ink-mute mb-1">
                  Check in
                </div>
                <input
                  type="date"
                  value={checkIn}
                  onChange={(e) => setCheckIn(e.target.value)}
                  className="w-full px-3 py-2 border border-sand-300 rounded-lg"
                />
              </label>
              <label className="block">
                <div className="text-xs font-bold uppercase tracking-wider text-ink-mute mb-1">
                  Check out
                </div>
                <input
                  type="date"
                  value={checkOut}
                  onChange={(e) => setCheckOut(e.target.value)}
                  className="w-full px-3 py-2 border border-sand-300 rounded-lg"
                />
              </label>
              <label className="block">
                <div className="text-xs font-bold uppercase tracking-wider text-ink-mute mb-1">
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
                <div className="text-xs font-bold uppercase tracking-wider text-ink-mute mb-1">
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
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setStep("guest")}
                className="px-4 py-2 text-sm font-bold text-ink-soft hover:bg-sand-100 rounded-lg"
              >
                Back
              </button>
              <button
                onClick={loadAvailability}
                disabled={picking}
                className="px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white font-extrabold rounded-lg text-sm disabled:opacity-50"
              >
                {picking ? "…" : "Find rooms"}
              </button>
            </div>
          </div>
        )}

        {step === "room" && (
          <div className="space-y-3">
            <div className="bg-sand-50 rounded-lg p-3 text-sm">
              {checkIn} → {checkOut} · {availableRooms.length} room
              {availableRooms.length === 1 ? "" : "s"} available
            </div>
            {availableRooms.length === 0 ? (
              <Empty>No rooms available for those dates.</Empty>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {availableRooms.map((room) => (
                  <button
                    key={room.id}
                    disabled={busy}
                    onClick={() =>
                      createReservation(room.id, Number(room.roomType.baseRate))
                    }
                    className="text-left p-3 bg-white border-2 border-sand-300 hover:border-amber-500 rounded-xl transition disabled:opacity-50"
                  >
                    <div className="flex items-center justify-between">
                      <div className="font-extrabold">Room {room.number}</div>
                      <div className="text-amber-700 font-bold tabular-nums">
                        {fmtEGP(room.roomType.baseRate)} EGP/n
                      </div>
                    </div>
                    <div className="text-xs text-ink-mute mt-1">
                      {room.roomType.name} · cap {room.roomType.capacity}
                    </div>
                  </button>
                ))}
              </div>
            )}
            <div className="flex gap-2 justify-between">
              <button
                onClick={() => setStep("dates")}
                className="px-4 py-2 text-sm font-bold text-ink-soft hover:bg-sand-100 rounded-lg"
              >
                Back
              </button>
              <button
                onClick={onClose}
                className="px-4 py-2 text-sm font-bold text-ink-soft hover:bg-sand-100 rounded-lg"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {err && (
          <div className="p-2 bg-status-bad-50 text-status-bad-700 rounded-lg text-sm">
            {err}
          </div>
        )}
      </div>
    </Modal>
  );
}

function Stepper({
  steps,
  current,
}: {
  steps: [string, string][];
  current: string;
}) {
  const i = steps.findIndex(([k]) => k === current);
  return (
    <div className="flex items-center gap-1">
      {steps.map(([k, label], idx) => (
        <div key={k} className="flex items-center gap-1 flex-1">
          <div
            className={`flex items-center gap-2 px-3 py-1 rounded-full text-xs font-bold ${
              idx <= i
                ? "bg-amber-600 text-white"
                : "bg-sand-100 text-ink-mute"
            }`}
          >
            <span>{idx + 1}.</span>
            <span>{label}</span>
          </div>
          {idx < steps.length - 1 && (
            <div className="flex-1 h-0.5 bg-sand-200" />
          )}
        </div>
      ))}
    </div>
  );
}

// ═══════════════════════════════════════════════
// TAB: WALK-IN
//
// Optimized for the front desk picking up the phone or talking to a
// guest at the counter: "do you have anything tonight?". Defaults to
// tonight → tomorrow, lists free rooms instantly, and a one-click
// "Book & check in" creates the reservation, posts ROOM_NIGHT
// charges, and flips status to CHECKED_IN in one go.
// ═══════════════════════════════════════════════

function WalkInTab({ staff }: { staff: Staff }) {
  const [from, setFrom] = useState(todayISO());
  const [to, setTo] = useState(addDays(todayISO(), 1));
  const [rooms, setRooms] = useState<Room[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [pickedRoom, setPickedRoom] = useState<Room | null>(null);

  async function load() {
    setLoading(true);
    setErr(null);
    try {
      const res = await authedFetch(
        `/api/hotel/availability?from=${from}&to=${to}`,
        { cache: "no-store" }
      );
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Failed");
      setRooms(d.rooms || []);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="space-y-4">
      <div className="bg-white border border-sand-200 rounded-xl p-4">
        <div className="flex flex-wrap items-end gap-3">
          <label className="block">
            <div className="text-[10px] font-bold uppercase tracking-wider text-ink-mute mb-1">
              From
            </div>
            <input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className="px-3 py-2 border border-sand-300 rounded-lg"
            />
          </label>
          <label className="block">
            <div className="text-[10px] font-bold uppercase tracking-wider text-ink-mute mb-1">
              To
            </div>
            <input
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className="px-3 py-2 border border-sand-300 rounded-lg"
            />
          </label>
          <button
            onClick={load}
            disabled={loading}
            className="px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white font-extrabold rounded-lg text-sm disabled:opacity-50"
          >
            {loading ? "…" : "Refresh"}
          </button>
          <div className="ms-auto text-sm text-ink-soft">
            {rooms.length} room{rooms.length === 1 ? "" : "s"} free
          </div>
        </div>
      </div>

      {err && (
        <div className="p-3 bg-status-bad-50 text-status-bad-700 rounded-lg text-sm">
          {err}
        </div>
      )}

      {loading ? (
        <div className="text-sm text-ink-mute">Loading…</div>
      ) : rooms.length === 0 ? (
        <Empty>No rooms free for that range.</Empty>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {rooms.map((room) => (
            <button
              key={room.id}
              onClick={() => setPickedRoom(room)}
              className="text-left p-4 bg-white border-2 border-sand-300 hover:border-amber-500 rounded-xl transition"
            >
              <div className="flex items-center justify-between">
                <div className="font-extrabold text-lg">Room {room.number}</div>
                <RoomStatusPill status={room.status} />
              </div>
              <div className="text-sm text-ink-soft">
                {room.roomType.name} · cap {room.roomType.capacity}
              </div>
              <div className="mt-2 text-amber-700 font-extrabold">
                {fmtEGP(room.roomType.baseRate)} EGP/night
              </div>
              <div className="mt-3 text-[11px] font-extrabold uppercase tracking-wider text-amber-700">
                Book & check in →
              </div>
            </button>
          ))}
        </div>
      )}

      {pickedRoom && (
        <WalkInBookingModal
          room={pickedRoom}
          from={from}
          to={to}
          onClose={() => setPickedRoom(null)}
          onDone={() => {
            setPickedRoom(null);
            load();
          }}
        />
      )}
    </div>
  );
}

/**
 * Modal for the walk-in flow: collect minimal guest details
 * (name + phone + nationality), create both the Guest and the
 * Reservation, then immediately check in (posting room-night
 * charges) — all in three sequential API calls. The UI shows a
 * single "Book & check in" CTA so the front desk doesn't have to
 * round-trip through three confirmation screens for a guest
 * standing in front of them.
 */
function WalkInBookingModal({
  room,
  from,
  to,
  onClose,
  onDone,
}: {
  room: Room;
  from: string;
  to: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [idNumber, setIdNumber] = useState("");
  const [nationality, setNationality] = useState("");
  const [adults, setAdults] = useState(2);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [step, setStep] = useState<string | null>(null);

  async function submit() {
    if (busy) return;
    if (!name.trim()) {
      setErr("Guest name required");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      // Step 1: create or reuse the guest. We don't dedupe automatic-
      // ally here — front desk has the option to look up the existing
      // guest in the Reservations tab if they want. This keeps the
      // walk-in flow fast.
      setStep("Creating guest…");
      const guestRes = await authedFetch("/api/hotel/guests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          phone: phone.trim() || null,
          idNumber: idNumber.trim() || null,
          nationality: nationality.trim() || null,
        }),
      });
      const guestData = await guestRes.json();
      if (!guestRes.ok) throw new Error(guestData.error || "Guest create failed");

      // Step 2: create the reservation.
      setStep("Booking room…");
      const reservationRes = await authedFetch("/api/hotel/reservations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          guestId: guestData.guest.id,
          roomId: room.id,
          checkInDate: from,
          checkOutDate: to,
          nightlyRate: Number(room.roomType.baseRate),
          adults,
          source: "WALK_IN",
        }),
      });
      const reservationData = await reservationRes.json();
      if (!reservationRes.ok)
        throw new Error(reservationData.error || "Booking failed");

      // Step 3: immediately check in.
      setStep("Checking in…");
      const checkInRes = await authedFetch(
        `/api/hotel/reservations/${reservationData.reservation.id}/checkin`,
        { method: "POST" }
      );
      if (!checkInRes.ok) {
        const d = await checkInRes.json().catch(() => ({}));
        throw new Error(d.error || "Check-in failed");
      }

      onDone();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
      setStep(null);
    }
  }

  return (
    <Modal onClose={onClose} title={`Walk-in — Room ${room.number}`}>
      <div className="space-y-3">
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm">
          {room.roomType.name} · {fmtEGP(room.roomType.baseRate)} EGP/night ·{" "}
          {from} → {to}
        </div>
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Guest name (required)"
          className="w-full px-3 py-2 border border-sand-300 rounded-lg"
        />
        <input
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder="Phone (optional)"
          className="w-full px-3 py-2 border border-sand-300 rounded-lg"
        />
        <div className="grid grid-cols-2 gap-2">
          <input
            value={idNumber}
            onChange={(e) => setIdNumber(e.target.value)}
            placeholder="ID / passport"
            className="px-3 py-2 border border-sand-300 rounded-lg"
          />
          <input
            value={nationality}
            onChange={(e) => setNationality(e.target.value)}
            placeholder="Nationality"
            className="px-3 py-2 border border-sand-300 rounded-lg"
          />
        </div>
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
        {err && (
          <div className="p-2 bg-status-bad-50 text-status-bad-700 rounded-lg text-sm">
            {err}
          </div>
        )}
        {step && (
          <div className="p-2 bg-amber-50 text-amber-700 rounded-lg text-sm">
            {step}
          </div>
        )}
        <div className="flex gap-2 justify-end">
          <button
            onClick={onClose}
            disabled={busy}
            className="px-4 py-2 text-sm font-bold text-ink-soft hover:bg-sand-100 rounded-lg disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={busy}
            className="px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white font-extrabold rounded-lg text-sm disabled:opacity-50"
          >
            {busy ? "…" : "Book & check in"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

// ═══════════════════════════════════════════════
// TAB: CALENDAR
//
// Month grid: rooms (rows) × days-of-month (columns). Each
// reservation that overlaps a day renders as a coloured block in
// that cell; click it to open the detail modal. Click an empty
// cell → opens the new-booking flow pre-filled with that room
// and date. Used by the owner for planning ("what does next week
// look like?") and by the front desk for visual conflict avoidance.
// ═══════════════════════════════════════════════

function CalendarTab({ staff }: { staff: Staff }) {
  const now = new Date();
  const [year, setYear] = useState(now.getUTCFullYear());
  const [month, setMonth] = useState(now.getUTCMonth()); // 0-indexed
  const [rooms, setRooms] = useState<Room[]>([]);
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [loading, setLoading] = useState(true);
  const [openId, setOpenId] = useState<string | null>(null);
  const [newBooking, setNewBooking] = useState<{
    room: Room;
    date: string;
  } | null>(null);

  const firstDay = useMemo(() => {
    const d = new Date(Date.UTC(year, month, 1));
    return d;
  }, [year, month]);
  const lastDay = useMemo(() => {
    const d = new Date(Date.UTC(year, month + 1, 0));
    return d;
  }, [year, month]);
  const daysInMonth = lastDay.getUTCDate();

  async function load() {
    setLoading(true);
    try {
      const [roomsRes, resRes] = await Promise.all([
        authedFetch("/api/hotel/rooms", { cache: "no-store" }).then((r) =>
          r.json()
        ),
        authedFetch(
          `/api/hotel/reservations?from=${fmtDate(firstDay)}&to=${fmtDate(
            new Date(Date.UTC(year, month + 1, 1))
          )}`,
          { cache: "no-store" }
        ).then((r) => r.json()),
      ]);
      setRooms(roomsRes.rooms || []);
      setReservations(resRes.reservations || []);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [year, month]);

  function shift(delta: number) {
    let m = month + delta;
    let y = year;
    if (m < 0) {
      m = 11;
      y--;
    } else if (m > 11) {
      m = 0;
      y++;
    }
    setYear(y);
    setMonth(m);
  }

  // Index reservations by room → list of resvs covering this room.
  // Each resv knows its first and last day-index on the visible grid.
  const resvByRoom = useMemo(() => {
    const map = new Map<
      string,
      Array<{
        reservation: Reservation;
        startCol: number; // day-of-month, 1-based
        endCol: number; // day-of-month, 1-based, inclusive
      }>
    >();
    for (const r of reservations) {
      // Skip cancelled / no-show — they don't occupy the room visually.
      if (r.status === "CANCELLED" || r.status === "NO_SHOW") continue;
      const start = new Date(r.checkInDate);
      const end = new Date(r.checkOutDate);
      // Clamp to the visible month.
      const visibleStart = start < firstDay ? firstDay : start;
      const visibleEndExclusive = end > new Date(Date.UTC(year, month + 1, 1))
        ? new Date(Date.UTC(year, month + 1, 1))
        : end;
      // checkout date is exclusive of the last night; subtract 1 day
      // to get the last occupied night.
      const visibleEnd = new Date(visibleEndExclusive);
      visibleEnd.setUTCDate(visibleEnd.getUTCDate() - 1);
      if (visibleEnd < visibleStart) continue;
      const startCol = visibleStart.getUTCDate();
      const endCol = visibleEnd.getUTCDate();
      const list = map.get(r.room.id) || [];
      list.push({ reservation: r, startCol, endCol });
      map.set(r.room.id, list);
    }
    return map;
  }, [reservations, firstDay, year, month]);

  const monthLabel = firstDay.toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <button
            onClick={() => shift(-1)}
            className="px-3 py-1.5 bg-sand-100 hover:bg-sand-200 text-ink font-bold rounded-lg text-sm"
          >
            ←
          </button>
          <div className="text-lg font-extrabold text-ink min-w-[140px] text-center">
            {monthLabel}
          </div>
          <button
            onClick={() => shift(1)}
            className="px-3 py-1.5 bg-sand-100 hover:bg-sand-200 text-ink font-bold rounded-lg text-sm"
          >
            →
          </button>
          <button
            onClick={() => {
              setYear(now.getUTCFullYear());
              setMonth(now.getUTCMonth());
            }}
            className="px-3 py-1.5 text-xs font-bold text-ink-soft hover:bg-sand-100 rounded-lg"
          >
            Today
          </button>
        </div>
        <div className="text-xs text-ink-mute">
          {rooms.length} rooms · {reservations.length} reservations this month
        </div>
      </div>

      {loading ? (
        <div className="text-sm text-ink-mute">Loading…</div>
      ) : rooms.length === 0 ? (
        <Empty>No rooms configured yet.</Empty>
      ) : (
        <div className="bg-white border border-sand-200 rounded-xl overflow-x-auto">
          <table className="border-collapse min-w-max">
            <thead>
              <tr>
                <th className="sticky start-0 z-10 bg-sand-50 text-left px-3 py-2 text-[11px] font-extrabold uppercase tracking-wider text-ink-mute border-b border-sand-200 min-w-[100px]">
                  Room
                </th>
                {Array.from({ length: daysInMonth }, (_, i) => i + 1).map(
                  (d) => {
                    const date = new Date(Date.UTC(year, month, d));
                    const isToday =
                      d === now.getUTCDate() &&
                      month === now.getUTCMonth() &&
                      year === now.getUTCFullYear();
                    const dow = date.getUTCDay();
                    const isWeekend = dow === 5 || dow === 6; // Egypt weekend = Fri/Sat
                    return (
                      <th
                        key={d}
                        className={`px-1 py-2 text-[10px] font-bold border-b border-sand-200 min-w-[28px] ${
                          isToday
                            ? "bg-amber-100 text-amber-800"
                            : isWeekend
                            ? "bg-sand-100 text-ink-mute"
                            : "text-ink-mute"
                        }`}
                      >
                        {d}
                      </th>
                    );
                  }
                )}
              </tr>
            </thead>
            <tbody>
              {rooms.map((room) => {
                const list = resvByRoom.get(room.id) || [];
                // Build a 1..daysInMonth array marking which day is
                // covered by which reservation. Then render: contiguous
                // runs become one wide block, gaps become clickable
                // empty cells.
                const cells: Array<{
                  reservation: Reservation;
                  span: number;
                }> | null[] = Array(daysInMonth).fill(null);
                for (const item of list) {
                  for (let d = item.startCol; d <= item.endCol; d++) {
                    cells[d - 1] = { reservation: item.reservation, span: 0 };
                  }
                }
                return (
                  <tr key={room.id} className="border-b border-sand-100">
                    <td className="sticky start-0 z-10 bg-white px-3 py-2 text-sm font-extrabold border-r border-sand-200">
                      <div>{room.number}</div>
                      <div className="text-[10px] font-normal text-ink-mute">
                        {room.roomType.name}
                      </div>
                    </td>
                    {Array.from({ length: daysInMonth }, (_, i) => i).map(
                      (idx) => {
                        const cell = cells[idx];
                        const day = idx + 1;
                        if (cell && typeof cell === "object") {
                          // Render block only on the first cell of a
                          // contiguous run (otherwise it'd repeat).
                          const isStart =
                            idx === 0 ||
                            !cells[idx - 1] ||
                            (cells[idx - 1] as { reservation: Reservation })
                              .reservation.id !== cell.reservation.id;
                          if (!isStart) return null;
                          // Compute span (how many cells this block covers).
                          let span = 1;
                          while (
                            idx + span < daysInMonth &&
                            cells[idx + span] &&
                            (cells[idx + span] as { reservation: Reservation })
                              .reservation.id === cell.reservation.id
                          ) {
                            span++;
                          }
                          const colorByStatus: Record<string, string> = {
                            BOOKED: "bg-ocean-200 hover:bg-ocean-300 text-ocean-900",
                            CHECKED_IN:
                              "bg-status-good-200 hover:bg-status-good-300 text-status-good-900",
                            CHECKED_OUT: "bg-sand-200 text-ink-mute",
                          };
                          const color =
                            colorByStatus[cell.reservation.status] ||
                            "bg-sand-200";
                          return (
                            <td
                              key={day}
                              colSpan={span}
                              className="p-0.5"
                            >
                              <button
                                onClick={() => setOpenId(cell.reservation.id)}
                                className={`w-full h-7 rounded text-[10px] font-bold truncate px-1 transition ${color}`}
                                title={`${cell.reservation.guest.name} · ${fmtDate(
                                  cell.reservation.checkInDate
                                )} → ${fmtDate(cell.reservation.checkOutDate)}`}
                              >
                                {cell.reservation.guest.name}
                              </button>
                            </td>
                          );
                        }
                        return (
                          <td
                            key={day}
                            className="p-0.5 align-middle"
                            onClick={() =>
                              setNewBooking({
                                room,
                                date: fmtDate(new Date(Date.UTC(year, month, day))),
                              })
                            }
                          >
                            <div className="w-full h-7 rounded hover:bg-sand-100 cursor-pointer" />
                          </td>
                        );
                      }
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3 text-xs text-ink-mute">
        <span className="inline-flex items-center gap-1">
          <span className="inline-block w-3 h-3 rounded bg-ocean-200" /> Booked
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="inline-block w-3 h-3 rounded bg-status-good-200" />{" "}
          Checked-in
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="inline-block w-3 h-3 rounded bg-sand-200" /> Past
        </span>
        <span className="ms-auto">
          Click a block to open the reservation. Click an empty cell to start
          a new booking on that room/date.
        </span>
      </div>

      {openId && (
        <ReservationDetailModal
          reservationId={openId}
          onClose={() => setOpenId(null)}
          onChange={load}
        />
      )}
      {newBooking && (
        <NewBookingModal
          prefill={{
            room: newBooking.room,
            checkIn: newBooking.date,
            checkOut: addDays(newBooking.date, 1),
          }}
          onClose={() => setNewBooking(null)}
          onCreated={() => {
            setNewBooking(null);
            load();
          }}
        />
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════
// TAB: ROOMS
// ═══════════════════════════════════════════════

function RoomsTab({ staff }: { staff: Staff }) {
  const [rooms, setRooms] = useState<Room[]>([]);
  const [roomTypes, setRoomTypes] = useState<RoomType[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    const [r, t] = await Promise.all([
      authedFetch("/api/hotel/rooms", { cache: "no-store" }).then((r) => r.json()),
      authedFetch("/api/hotel/room-types", { cache: "no-store" }).then((r) =>
        r.json()
      ),
    ]);
    setRooms(r.rooms || []);
    setRoomTypes(t.roomTypes || []);
    setLoading(false);
  }
  useEffect(() => {
    load();
  }, []);

  async function setStatus(roomId: string, status: Room["status"]) {
    const res = await authedFetch(`/api/hotel/rooms/${roomId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    if (res.ok) load();
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-extrabold uppercase tracking-wider text-ink-mute">
          {rooms.length} room{rooms.length === 1 ? "" : "s"}
        </h2>
        {staff.role === "OWNER" && (
          <button
            onClick={() => setShowAdd(true)}
            className="px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white font-extrabold rounded-lg text-sm"
          >
            + Add room
          </button>
        )}
      </div>
      {loading ? (
        <div className="text-sm text-ink-mute">Loading…</div>
      ) : rooms.length === 0 ? (
        <Empty>No rooms yet. Add one to start taking bookings.</Empty>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          {rooms.map((room) => (
            <div
              key={room.id}
              className="bg-white border border-sand-200 rounded-xl p-3"
            >
              <div className="flex items-center justify-between mb-2">
                <div className="font-extrabold text-lg">{room.number}</div>
                <RoomStatusPill status={room.status} />
              </div>
              <div className="text-xs text-ink-mute mb-3">
                {room.roomType.name} ·{" "}
                {fmtEGP(room.roomType.baseRate)} EGP/n
              </div>
              <select
                value={room.status}
                onChange={(e) =>
                  setStatus(room.id, e.target.value as Room["status"])
                }
                className="w-full px-2 py-1 text-xs border border-sand-300 rounded"
              >
                <option value="VACANT_CLEAN">Vacant clean</option>
                <option value="VACANT_DIRTY">Vacant dirty</option>
                <option value="OCCUPIED">Occupied</option>
                <option value="MAINTENANCE">Maintenance</option>
              </select>
            </div>
          ))}
        </div>
      )}

      {showAdd && (
        <NewRoomModal
          roomTypes={roomTypes}
          onClose={() => setShowAdd(false)}
          onCreated={() => {
            setShowAdd(false);
            load();
          }}
        />
      )}
    </div>
  );
}

function RoomStatusPill({ status }: { status: Room["status"] }) {
  const map = {
    VACANT_CLEAN: ["bg-status-good-100 text-status-good-700", "Clean"],
    VACANT_DIRTY: ["bg-status-warn-100 text-status-warn-700", "Dirty"],
    OCCUPIED: ["bg-ocean-100 text-ocean-700", "Occupied"],
    MAINTENANCE: ["bg-status-bad-100 text-status-bad-700", "Maint."],
  } as const;
  const [classes, label] = map[status];
  return (
    <span
      className={`px-1.5 py-0.5 text-[9px] font-extrabold uppercase tracking-wider rounded ${classes}`}
    >
      {label}
    </span>
  );
}

function NewRoomModal({
  roomTypes,
  onClose,
  onCreated,
}: {
  roomTypes: RoomType[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const [number, setNumber] = useState("");
  const [floor, setFloor] = useState("");
  const [roomTypeId, setRoomTypeId] = useState(roomTypes[0]?.id || "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit() {
    if (busy) return;
    if (!number.trim()) {
      setErr("Room number required");
      return;
    }
    if (!roomTypeId) {
      setErr("Add a room type first");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const res = await authedFetch("/api/hotel/rooms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          number: number.trim(),
          floor: floor ? Number(floor) : null,
          roomTypeId,
        }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Failed");
      onCreated();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal onClose={onClose} title="New room">
      <div className="space-y-3">
        {roomTypes.length === 0 ? (
          <div className="bg-status-warn-50 border border-status-warn-200 text-status-warn-700 rounded-lg p-3 text-sm">
            Add at least one room type first (Setup tab).
          </div>
        ) : (
          <>
            <input
              value={number}
              onChange={(e) => setNumber(e.target.value)}
              placeholder='Room number (e.g. "101", "Sea-1")'
              className="w-full px-3 py-2 border border-sand-300 rounded-lg"
              autoFocus
            />
            <input
              value={floor}
              onChange={(e) => setFloor(e.target.value)}
              type="number"
              placeholder="Floor (optional)"
              className="w-full px-3 py-2 border border-sand-300 rounded-lg"
            />
            <select
              value={roomTypeId}
              onChange={(e) => setRoomTypeId(e.target.value)}
              className="w-full px-3 py-2 border border-sand-300 rounded-lg"
            >
              {roomTypes.map((rt) => (
                <option key={rt.id} value={rt.id}>
                  {rt.name} ({fmtEGP(rt.baseRate)} EGP/n)
                </option>
              ))}
            </select>
          </>
        )}
        {err && (
          <div className="p-2 bg-status-bad-50 text-status-bad-700 rounded-lg text-sm">
            {err}
          </div>
        )}
        <div className="flex gap-2 justify-end">
          <button
            onClick={onClose}
            disabled={busy}
            className="px-4 py-2 text-sm font-bold text-ink-soft hover:bg-sand-100 rounded-lg"
          >
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={busy || roomTypes.length === 0}
            className="px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white font-extrabold rounded-lg text-sm disabled:opacity-50"
          >
            {busy ? "…" : "Add room"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

// ═══════════════════════════════════════════════
// TAB: SETUP (Room types)
// ═══════════════════════════════════════════════

function ConfigTab({ staff }: { staff: Staff }) {
  const [roomTypes, setRoomTypes] = useState<RoomType[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNew, setShowNew] = useState(false);

  async function load() {
    setLoading(true);
    const r = await authedFetch("/api/hotel/room-types", { cache: "no-store" }).then(
      (r) => r.json()
    );
    setRoomTypes(r.roomTypes || []);
    setLoading(false);
  }
  useEffect(() => {
    load();
  }, []);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-extrabold uppercase tracking-wider text-ink-mute">
          Room types
        </h2>
        {staff.role === "OWNER" && (
          <button
            onClick={() => setShowNew(true)}
            className="px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white font-extrabold rounded-lg text-sm"
          >
            + Add type
          </button>
        )}
      </div>
      {loading ? (
        <div className="text-sm text-ink-mute">Loading…</div>
      ) : roomTypes.length === 0 ? (
        <Empty>No room types yet. Add one to start adding rooms.</Empty>
      ) : (
        <div className="space-y-2">
          {roomTypes.map((rt) => (
            <div
              key={rt.id}
              className="bg-white border border-sand-200 rounded-xl p-4 flex items-center justify-between"
            >
              <div>
                <div className="font-extrabold">{rt.name}</div>
                <div className="text-xs text-ink-mute">
                  {fmtEGP(rt.baseRate)} EGP base
                  {rt.weekendRate && (
                    <>
                      {" "}
                      · <strong>{fmtEGP(rt.weekendRate)}</strong> EGP weekend
                    </>
                  )}
                  {" "}
                  · cap {rt.capacity}
                  {rt.minNights > 1 && (
                    <>
                      {" "}
                      · min {rt.minNights} nights
                    </>
                  )}
                  {" · "}
                  {rt._count?.rooms || 0} room
                  {(rt._count?.rooms || 0) === 1 ? "" : "s"}
                </div>
                {rt.amenities.length > 0 && (
                  <div className="text-[11px] text-ink-mute mt-1">
                    {rt.amenities.join(" · ")}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {showNew && (
        <NewRoomTypeModal
          onClose={() => setShowNew(false)}
          onCreated={() => {
            setShowNew(false);
            load();
          }}
        />
      )}

      {/* OTA iCal sync — owner manages Booking.com / Airbnb feeds. */}
      <IcalSyncSection staff={staff} />

      {/* Direct booking link — copy/paste for the owner's website. */}
      <DirectBookingSection />
    </div>
  );
}

/**
 * OTA iCal feeds. The owner pastes the per-room iCal URL Booking.com
 * or Airbnb gives them, picks which physical room it covers, saves.
 * The cron `/api/cron/hotel-ical-sync` runs every 30 min and pulls
 * each feed; "Sync now" forces an immediate run.
 */
function IcalSyncSection({ staff }: { staff: Staff }) {
  const [entries, setEntries] = useState<
    Array<{
      source: "BOOKING_COM" | "AIRBNB" | "OTHER";
      url: string;
      roomNumber: string;
      lastSyncedAt?: string;
      lastError?: string;
      reservationsCreated?: number;
    }>
  >([]);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  // New-entry form draft
  const [draft, setDraft] = useState<{
    source: "BOOKING_COM" | "AIRBNB" | "OTHER";
    url: string;
    roomNumber: string;
  }>({ source: "BOOKING_COM", url: "", roomNumber: "" });

  async function load() {
    setLoading(true);
    const [e, r] = await Promise.all([
      authedFetch("/api/hotel/ical", { cache: "no-store" }).then((r) => r.json()),
      authedFetch("/api/hotel/rooms", { cache: "no-store" }).then((r) => r.json()),
    ]);
    setEntries(e.entries || []);
    setRooms(r.rooms || []);
    setLoading(false);
  }
  useEffect(() => {
    load();
  }, []);

  async function save(next: typeof entries) {
    setBusy(true);
    setErr(null);
    try {
      const res = await authedFetch("/api/hotel/ical", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entries: next }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Save failed");
      setEntries(d.entries || []);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Save failed");
    } finally {
      setBusy(false);
    }
  }

  async function addEntry() {
    if (!draft.url.trim() || !draft.roomNumber) {
      setErr("URL and room are required.");
      return;
    }
    const next = [...entries, { ...draft, url: draft.url.trim() }];
    await save(next);
    setDraft({ source: "BOOKING_COM", url: "", roomNumber: "" });
  }

  async function removeEntry(idx: number) {
    if (!confirm("Remove this iCal feed? Already-imported reservations stay.")) return;
    const next = entries.filter((_, i) => i !== idx);
    await save(next);
  }

  async function syncNow() {
    if (syncing) return;
    setSyncing(true);
    setSyncResult(null);
    setErr(null);
    try {
      const res = await authedFetch("/api/hotel/ical", { method: "PUT" });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Sync failed");
      setSyncResult(
        `Synced — ${d.totalCreated} new, ${d.totalUpdated} updated, ${d.totalCancelled} cancelled${d.errors ? `, ${d.errors} error(s)` : ""}.`
      );
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Sync failed");
    } finally {
      setSyncing(false);
    }
  }

  return (
    <section className="mt-8">
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-sm font-extrabold uppercase tracking-wider text-ink-mute">
          OTA calendars (Booking.com / Airbnb)
        </h2>
        {entries.length > 0 && (
          <button
            onClick={syncNow}
            disabled={syncing}
            className="px-3 py-1.5 bg-ocean-600 hover:bg-ocean-700 text-white font-extrabold rounded-lg text-xs disabled:opacity-50"
          >
            {syncing ? "Syncing…" : "Sync now"}
          </button>
        )}
      </div>

      {syncResult && (
        <div className="mb-3 p-2 bg-status-good-50 text-status-good-700 rounded-lg text-sm">
          {syncResult}
        </div>
      )}
      {err && (
        <div className="mb-3 p-2 bg-status-bad-50 text-status-bad-700 rounded-lg text-sm">
          {err}
        </div>
      )}

      {loading ? (
        <div className="text-sm text-ink-mute">Loading…</div>
      ) : entries.length === 0 ? (
        <div className="bg-white border border-sand-200 rounded-xl p-5 text-sm text-ink-soft">
          No OTA calendars configured. Paste the iCal URL Booking.com or
          Airbnb gives you (one per room) below to mirror their bookings
          into this dashboard.
        </div>
      ) : (
        <div className="space-y-2">
          {entries.map((e, idx) => (
            <div
              key={idx}
              className="bg-white border border-sand-200 rounded-xl p-3 flex items-start gap-3"
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wider rounded bg-ocean-100 text-ocean-700">
                    {e.source.replace("_", ".")}
                  </span>
                  <span className="text-sm font-extrabold">
                    Room {e.roomNumber}
                  </span>
                </div>
                <div className="text-[11px] text-ink-mute mt-1 break-all">
                  {e.url}
                </div>
                <div className="text-[11px] text-ink-mute mt-0.5">
                  {e.lastSyncedAt
                    ? `Last synced: ${new Date(e.lastSyncedAt).toLocaleString()}`
                    : "Never synced"}
                  {e.reservationsCreated
                    ? ` · ${e.reservationsCreated} imported`
                    : ""}
                </div>
                {e.lastError && (
                  <div className="text-[11px] text-status-bad-700 mt-0.5">
                    Error: {e.lastError}
                  </div>
                )}
              </div>
              {staff.role === "OWNER" && (
                <button
                  onClick={() => removeEntry(idx)}
                  disabled={busy}
                  className="text-[11px] font-bold text-status-bad-700 hover:underline shrink-0"
                >
                  Remove
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {staff.role === "OWNER" && (
        <div className="mt-3 bg-white border border-sand-200 rounded-xl p-3">
          <div className="text-[11px] font-extrabold uppercase tracking-wider text-ink-mute mb-2">
            Add a feed
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <select
              value={draft.source}
              onChange={(e) =>
                setDraft({ ...draft, source: e.target.value as typeof draft.source })
              }
              className="px-3 py-2 border border-sand-300 rounded-lg text-sm"
            >
              <option value="BOOKING_COM">Booking.com</option>
              <option value="AIRBNB">Airbnb</option>
              <option value="OTHER">Other</option>
            </select>
            <select
              value={draft.roomNumber}
              onChange={(e) => setDraft({ ...draft, roomNumber: e.target.value })}
              className="px-3 py-2 border border-sand-300 rounded-lg text-sm"
            >
              <option value="">— pick room —</option>
              {rooms.map((r) => (
                <option key={r.id} value={r.number}>
                  Room {r.number} ({r.roomType.name})
                </option>
              ))}
            </select>
            <input
              type="url"
              value={draft.url}
              onChange={(e) => setDraft({ ...draft, url: e.target.value })}
              placeholder="https://…/ical/xyz.ics"
              className="px-3 py-2 border border-sand-300 rounded-lg text-sm"
            />
          </div>
          <button
            onClick={addEntry}
            disabled={busy}
            className="mt-3 px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white font-extrabold rounded-lg text-sm disabled:opacity-50"
          >
            {busy ? "…" : "+ Add feed"}
          </button>
          <p className="text-[11px] text-ink-mute mt-2">
            Where to find the URL: Booking.com extranet → Rates &amp;
            Availability → Sync calendars; Airbnb host dashboard → Listing
            → Calendar → Availability → Export calendar. The OTA gives you
            one URL per listing/room.
          </p>
        </div>
      )}
    </section>
  );
}

/** Show the public direct-booking URL so the owner can paste it on
 *  their website / WhatsApp / Instagram bio. */
function DirectBookingSection() {
  const restaurantSlug =
    typeof window !== "undefined"
      ? process.env.NEXT_PUBLIC_RESTAURANT_SLUG || "neom-dahab"
      : "neom-dahab";
  const url =
    typeof window !== "undefined" ? `${window.location.origin}/book` : "/book";
  return (
    <section className="mt-8">
      <h2 className="text-sm font-extrabold uppercase tracking-wider text-ink-mute mb-2">
        Direct booking page
      </h2>
      <div className="bg-white border border-sand-200 rounded-xl p-4">
        <p className="text-sm text-ink-soft mb-2">
          Public URL guests can use to book your hotel directly. Share it on
          WhatsApp, Instagram bio, or embed on your website. Bookings here
          show up in Reservations with source = DIRECT.
        </p>
        <div className="flex items-center gap-2">
          <code className="flex-1 bg-sand-50 px-3 py-2 rounded font-mono text-sm break-all">
            {url}
          </code>
          <button
            onClick={() => {
              if (typeof window !== "undefined")
                navigator.clipboard.writeText(url);
            }}
            className="px-3 py-2 bg-amber-600 hover:bg-amber-700 text-white font-bold rounded text-xs"
          >
            Copy
          </button>
        </div>
        <p className="text-[11px] text-ink-mute mt-2">
          Slug: <code className="font-mono">{restaurantSlug}</code> ·
          Configurable in Vercel env as <code>NEXT_PUBLIC_RESTAURANT_SLUG</code>
          .
        </p>
      </div>
    </section>
  );
}

function NewRoomTypeModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: () => void;
}) {
  const [name, setName] = useState("");
  const [baseRate, setBaseRate] = useState("");
  const [weekendRate, setWeekendRate] = useState("");
  const [minNights, setMinNights] = useState("1");
  const [capacity, setCapacity] = useState("2");
  const [amenitiesStr, setAmenitiesStr] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit() {
    if (busy) return;
    if (!name.trim()) {
      setErr("Name required");
      return;
    }
    const rate = Number(baseRate);
    if (!Number.isFinite(rate) || rate <= 0) {
      setErr("Rate must be > 0");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const res = await authedFetch("/api/hotel/room-types", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          baseRate: rate,
          weekendRate: weekendRate.trim() ? Number(weekendRate) : undefined,
          minNights: Math.max(1, Number(minNights) || 1),
          capacity: Number(capacity) || 2,
          amenities: amenitiesStr
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean),
        }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Failed");
      onCreated();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal onClose={onClose} title="New room type">
      <div className="space-y-3">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder='Name (e.g. "Sea View Suite")'
          className="w-full px-3 py-2 border border-sand-300 rounded-lg"
          autoFocus
        />
        <div className="grid grid-cols-2 gap-2">
          <label className="block">
            <div className="text-[10px] font-bold uppercase tracking-wider text-ink-mute mb-1">
              Base rate (EGP/night)
            </div>
            <input
              type="number"
              step="0.01"
              value={baseRate}
              onChange={(e) => setBaseRate(e.target.value)}
              placeholder="1500"
              className="w-full px-3 py-2 border border-sand-300 rounded-lg"
            />
          </label>
          <label className="block">
            <div className="text-[10px] font-bold uppercase tracking-wider text-ink-mute mb-1">
              Weekend rate (Fri/Sat)
            </div>
            <input
              type="number"
              step="0.01"
              value={weekendRate}
              onChange={(e) => setWeekendRate(e.target.value)}
              placeholder="optional"
              className="w-full px-3 py-2 border border-sand-300 rounded-lg"
            />
          </label>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <label className="block">
            <div className="text-[10px] font-bold uppercase tracking-wider text-ink-mute mb-1">
              Capacity (guests)
            </div>
            <input
              type="number"
              min={1}
              value={capacity}
              onChange={(e) => setCapacity(e.target.value)}
              className="w-full px-3 py-2 border border-sand-300 rounded-lg"
            />
          </label>
          <label className="block">
            <div className="text-[10px] font-bold uppercase tracking-wider text-ink-mute mb-1">
              Min nights
            </div>
            <input
              type="number"
              min={1}
              value={minNights}
              onChange={(e) => setMinNights(e.target.value)}
              className="w-full px-3 py-2 border border-sand-300 rounded-lg"
            />
          </label>
        </div>
        <input
          value={amenitiesStr}
          onChange={(e) => setAmenitiesStr(e.target.value)}
          placeholder='Amenities, comma-separated (e.g. "sea-view, ac, balcony")'
          className="w-full px-3 py-2 border border-sand-300 rounded-lg"
        />
        {err && (
          <div className="p-2 bg-status-bad-50 text-status-bad-700 rounded-lg text-sm">
            {err}
          </div>
        )}
        <div className="flex gap-2 justify-end">
          <button
            onClick={onClose}
            disabled={busy}
            className="px-4 py-2 text-sm font-bold text-ink-soft hover:bg-sand-100 rounded-lg"
          >
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={busy}
            className="px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white font-extrabold rounded-lg text-sm disabled:opacity-50"
          >
            {busy ? "…" : "Add type"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

// ═══════════════════════════════════════════════
// MODAL PRIMITIVE
// ═══════════════════════════════════════════════

function Modal({
  onClose,
  title,
  children,
  wide = false,
}: {
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  wide?: boolean;
}) {
  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-start sm:items-center justify-center p-4 overflow-y-auto"
      onClick={onClose}
    >
      <div
        className={`bg-white rounded-2xl shadow-xl w-full ${
          wide ? "max-w-2xl" : "max-w-md"
        } my-8`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-6 py-4 border-b border-sand-200 flex items-center justify-between">
          <h3 className="text-lg font-extrabold text-ink">{title}</h3>
          <button
            onClick={onClose}
            className="text-ink-mute hover:text-ink text-xl leading-none"
            aria-label="Close"
          >
            ×
          </button>
        </div>
        <div className="px-6 py-4">{children}</div>
      </div>
    </div>
  );
}
