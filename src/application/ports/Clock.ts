// ─────────────────────────────────────────────────────────────────
// Clock port — abstraction over `new Date()` and `Date.now()`.
//
// Why: every place in the source repo that does Date.now() or
// new Date() is untestable in time. By going through this port,
// tests inject a FakeClock that returns deterministic times.
//
// Implemented by infrastructure/time/SystemClock.ts (production) and
// FakeClock test helpers.
// ─────────────────────────────────────────────────────────────────

export interface Clock {
  now(): Date;
  /**
   * Wall-clock time in the restaurant's local timezone, as a Date
   * whose .getHours()/.getMinutes() reflect that timezone.
   * Source repo: src/lib/restaurant-config.ts → nowInRestaurantTz.
   */
  nowInRestaurantTz(): Date;
}
