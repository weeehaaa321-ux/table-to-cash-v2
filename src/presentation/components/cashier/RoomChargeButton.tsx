"use client";

import { useEffect, useState } from "react";
import { staffFetch } from "@/lib/staff-fetch";

type Reservation = {
  id: string;
  guest: { name: string; phone: string | null };
  room: { number: string; roomType: { name: string } };
  checkInDate: string;
  checkOutDate: string;
};

type Props = {
  /** Cashier's staff id — required for x-staff-id auth header. */
  staffId: string;
  /** Order IDs of unpaid orders in the current round. We'll charge
   *  each one to the picked reservation in sequence. */
  orderIds: string[];
  tableLabel: string;
  /** Called after a successful charge. Cashier list refreshes. */
  onSuccess: () => void;
};

/**
 * Renders a "Charge to Room" button next to (above) the cash/card/
 * instapay payment grid in the cashier UI. Only shown to properties
 * with the hotel module enabled — gated by the visibility check the
 * parent does (it knows whether `hotelEnabled` from /api/hotel).
 *
 * Click flow:
 *   1) fetch in-house reservations from /api/hotel/today
 *   2) cashier picks a row (guest + room number)
 *   3) for each orderId in the round, POST /api/hotel/charge-to-room
 *   4) on success, fire onSuccess so the session list re-fetches
 */
export function RoomChargeButton({ staffId, orderIds, tableLabel, onSuccess }: Props) {
  const [open, setOpen] = useState(false);
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setError(null);
    staffFetch(staffId, "/api/hotel/today", { cache: "no-store" })
      .then((r) => r.json())
      .then((data) => {
        setReservations(data.inHouse || []);
      })
      .catch(() => setError("Couldn't load in-house guests"))
      .finally(() => setLoading(false));
  }, [open]);

  async function charge(reservationId: string) {
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      for (const orderId of orderIds) {
        const res = await staffFetch(staffId, "/api/hotel/charge-to-room", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ orderId, reservationId }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || `Charge failed (${res.status})`);
        }
      }
      setOpen(false);
      onSuccess();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Charge failed");
    } finally {
      setSubmitting(false);
    }
  }

  const filtered = search.trim()
    ? reservations.filter((r) => {
        const q = search.trim().toLowerCase();
        return (
          r.guest.name.toLowerCase().includes(q) ||
          r.room.number.toLowerCase().includes(q) ||
          (r.guest.phone || "").toLowerCase().includes(q)
        );
      })
    : reservations;

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        disabled={orderIds.length === 0}
        className="w-full py-4 text-sm font-extrabold uppercase tracking-wider text-white bg-gradient-to-r from-amber-600 to-amber-700 hover:from-amber-700 hover:to-amber-800 transition active:scale-[0.99] flex items-center justify-center gap-2 border-t-2 border-sand-200 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        <span className="text-xl leading-none">🛏️</span>
        <span>Charge to Room</span>
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => !submitting && setOpen(false)}
        >
          <div
            className="bg-white rounded-2xl shadow-xl max-w-md w-full max-h-[80vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-6 py-4 border-b border-sand-200">
              <h3 className="text-lg font-extrabold text-ink">Charge to Room</h3>
              <p className="text-xs text-ink-soft mt-1">
                {tableLabel} · pick the in-house guest to charge.
              </p>
            </div>

            <div className="px-6 py-3 border-b border-sand-100">
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by name, room number, or phone…"
                className="w-full px-3 py-2 text-sm border border-sand-300 rounded-lg focus:outline-none focus:border-ocean-500"
                autoFocus
              />
            </div>

            <div className="flex-1 overflow-y-auto px-3 py-2">
              {loading ? (
                <div className="text-center py-12 text-sm text-ink-mute">
                  Loading…
                </div>
              ) : filtered.length === 0 ? (
                <div className="text-center py-12 text-sm text-ink-mute">
                  {reservations.length === 0
                    ? "No guests currently checked in."
                    : "No match for that search."}
                </div>
              ) : (
                filtered.map((r) => (
                  <button
                    key={r.id}
                    disabled={submitting}
                    onClick={() => charge(r.id)}
                    className="w-full text-left px-4 py-3 my-1 rounded-lg hover:bg-sand-50 active:bg-sand-100 transition flex items-center justify-between gap-3 disabled:opacity-50"
                  >
                    <div>
                      <div className="font-extrabold text-ink">
                        Room {r.room.number}{" "}
                        <span className="text-xs font-bold text-ink-mute">
                          ({r.room.roomType.name})
                        </span>
                      </div>
                      <div className="text-sm text-ink-soft">{r.guest.name}</div>
                    </div>
                    <span className="text-xs font-extrabold uppercase text-amber-700">
                      Charge →
                    </span>
                  </button>
                ))
              )}
            </div>

            {error && (
              <div className="px-6 py-2 text-sm text-status-bad-700 bg-status-bad-50 border-t border-status-bad-200">
                {error}
              </div>
            )}

            <div className="px-6 py-3 border-t border-sand-200 flex justify-end gap-2">
              <button
                onClick={() => setOpen(false)}
                disabled={submitting}
                className="px-4 py-2 text-sm font-bold text-ink-soft hover:bg-sand-100 rounded-lg disabled:opacity-50"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
