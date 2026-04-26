// Central per-deploy restaurant configuration. Every client is a
// separate deploy, so these are env vars the operator sets at build/run
// time — not DB fields. Kept in one file so spinning up a second client
// means editing .env and a seed script, nothing else.
//
// All four are also exposed via NEXT_PUBLIC_* so the client bundle can
// read them. Next.js inlines NEXT_PUBLIC_* at build time, so a change
// requires a rebuild, which is fine for per-tenant deploys.

export const RESTAURANT_SLUG =
  process.env.NEXT_PUBLIC_RESTAURANT_SLUG || "neom-dahab";

export const RESTAURANT_TZ =
  process.env.NEXT_PUBLIC_RESTAURANT_TZ || "Africa/Cairo";

export const RESTAURANT_NAME =
  process.env.NEXT_PUBLIC_RESTAURANT_NAME || "Neom Dahab";

export const RESTAURANT_CURRENCY =
  process.env.NEXT_PUBLIC_RESTAURANT_CURRENCY || "EGP";

// Flat fee added to DELIVERY orders. Single source of truth — every
// client UI and the server-side createOrder all read this. Without
// this, the fee was hardcoded 3× in different files and never written
// to the DB, so receipts/printouts said one number while the order
// row showed another. Operator can override via NEXT_PUBLIC_DELIVERY_FEE.
export const DELIVERY_FEE = (() => {
  const raw = process.env.NEXT_PUBLIC_DELIVERY_FEE;
  if (!raw) return 50;
  const n = parseInt(raw, 10);
  return isFinite(n) && n >= 0 ? n : 50;
})();

// Returns a Date that — when read with .getHours() / .getMinutes() /
// etc — reports the wall-clock time in the restaurant's local TZ.
// NOT a real moment in time: .toISOString() will lie. Use only for
// wall-clock comparisons ("is it after 6am?"), never for persistence.
export function nowInRestaurantTz(base: Date = new Date()): Date {
  return new Date(base.toLocaleString("en-US", { timeZone: RESTAURANT_TZ }));
}
