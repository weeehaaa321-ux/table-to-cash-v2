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
      const role = data.staff.role;
      if (!["OWNER", "FRONT_DESK"].includes(role)) {
        throw new Error("Owner or front-desk role required");
      }
      onLogin({ id: data.staff.id, name: data.staff.name, role });
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

type Tab = "today" | "reservations" | "rooms" | "config";

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
            ["reservations", "Reservations"],
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
        {tab === "reservations" && <ReservationsTab staff={staff} />}
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
  const [openFolio, setOpenFolio] = useState(false);
  return (
    <>
      <div className="bg-white border border-sand-200 rounded-xl p-4 flex flex-wrap items-center gap-3">
        <div className="flex-1 min-w-[180px]">
          <div className="font-extrabold text-ink">{reservation.guest.name}</div>
          <div className="text-xs text-ink-soft">
            Room {reservation.room.number} · until{" "}
            {fmtDate(reservation.checkOutDate)} · folio{" "}
            <strong>{fmtEGP(folioBalance(reservation.folio))} EGP</strong>
          </div>
        </div>
        <button
          onClick={() => setOpenFolio(true)}
          className="px-3 py-1.5 bg-sand-100 hover:bg-sand-200 text-ink-soft font-bold rounded-lg text-xs"
        >
          Folio
        </button>
      </div>
      {openFolio && (
        <FolioModal
          reservation={reservation}
          onClose={() => setOpenFolio(false)}
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

function FolioModal({
  reservation,
  onClose,
  onChange,
}: {
  reservation: Reservation;
  onClose: () => void;
  onChange: () => void;
}) {
  const [refresh, setRefresh] = useState(0);
  const [folio, setFolio] = useState<Folio | null>(reservation.folio);

  // Re-fetch the reservation (and its folio) so newly added charges
  // appear without closing the modal.
  useEffect(() => {
    if (refresh === 0) return;
    authedFetch(`/api/hotel/reservations/${reservation.id}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => setFolio(d.reservation?.folio || null));
  }, [refresh, reservation.id]);

  const [showAdd, setShowAdd] = useState(false);
  const balance = folioBalance(folio);

  return (
    <Modal
      onClose={onClose}
      title={`Folio — ${reservation.guest.name} (Room ${reservation.room.number})`}
      wide
    >
      <div className="space-y-4">
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 flex items-center justify-between">
          <span className="text-xs font-bold text-amber-700 uppercase tracking-wider">
            Balance
          </span>
          <span className="text-2xl font-extrabold text-amber-800">
            {fmtEGP(balance)} EGP
          </span>
        </div>

        <div className="border border-sand-200 rounded-lg overflow-hidden">
          <div className="grid grid-cols-[1fr_auto_auto] gap-3 px-3 py-2 bg-sand-50 text-[11px] font-extrabold uppercase tracking-wider text-ink-mute">
            <div>Description</div>
            <div>Type</div>
            <div className="text-right">Amount</div>
          </div>
          {(folio?.charges || []).length === 0 ? (
            <div className="px-3 py-6 text-sm text-ink-mute text-center">
              No charges yet.
            </div>
          ) : (
            (folio!.charges || []).map((c) => (
              <div
                key={c.id}
                className={`grid grid-cols-[1fr_auto_auto] gap-3 px-3 py-2 text-sm border-t border-sand-200 ${
                  c.voided ? "line-through text-ink-mute" : ""
                }`}
              >
                <div>{c.description}</div>
                <div className="text-xs text-ink-mute">{c.type}</div>
                <div className="text-right font-bold tabular-nums">
                  {fmtEGP(c.amount)}
                </div>
              </div>
            ))
          )}
        </div>

        <div className="flex flex-wrap gap-2 justify-between">
          <button
            onClick={() => setShowAdd(true)}
            className="px-4 py-2 bg-sand-100 hover:bg-sand-200 text-ink font-bold rounded-lg text-sm"
          >
            + Add charge (minibar / misc)
          </button>
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-bold text-ink-soft hover:bg-sand-100 rounded-lg"
          >
            Close
          </button>
        </div>

        {showAdd && (
          <AddChargeModal
            folioId={folio!.id}
            onClose={() => setShowAdd(false)}
            onAdded={() => {
              setShowAdd(false);
              setRefresh((n) => n + 1);
              onChange();
            }}
          />
        )}
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
                <tr key={r.id} className="border-t border-sand-200 hover:bg-sand-50">
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
}: {
  onClose: () => void;
  onCreated: () => void;
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

  const [checkIn, setCheckIn] = useState(todayISO());
  const [checkOut, setCheckOut] = useState(addDays(todayISO(), 1));
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
      setStep("dates");
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

  async function createReservation(roomId: string, nightlyRate: number) {
    if (!guest) return;
    setBusy(true);
    setErr(null);
    try {
      const res = await authedFetch("/api/hotel/reservations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          guestId: guest.id,
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
    <Modal onClose={onClose} title="New booking" wide>
      <div className="space-y-4">
        <Stepper
          steps={[
            ["guest", "Guest"],
            ["dates", "Dates"],
            ["room", "Room"],
          ]}
          current={step}
        />

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
                      setStep("dates");
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
                  {fmtEGP(rt.baseRate)} EGP/night · cap {rt.capacity} ·{" "}
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
    </div>
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
        <input
          type="number"
          step="0.01"
          value={baseRate}
          onChange={(e) => setBaseRate(e.target.value)}
          placeholder="Nightly rate (EGP)"
          className="w-full px-3 py-2 border border-sand-300 rounded-lg"
        />
        <input
          type="number"
          min={1}
          value={capacity}
          onChange={(e) => setCapacity(e.target.value)}
          placeholder="Capacity (guests)"
          className="w-full px-3 py-2 border border-sand-300 rounded-lg"
        />
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
