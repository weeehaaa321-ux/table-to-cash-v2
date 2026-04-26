import type { Clock } from "@/application/ports/Clock";
import { env } from "../config/env";

/**
 * Production Clock implementation.
 *
 * `nowInRestaurantTz()` returns a Date whose .getHours() / etc. report
 * the wall-clock time in RESTAURANT_TZ. Mirrors source repo
 * `src/lib/restaurant-config.ts` → `nowInRestaurantTz()`.
 *
 * NOTE: the returned Date's .toISOString() will lie — it's not a real
 * moment in time, only useful for wall-clock comparisons. Callers that
 * need a real moment should use `now()` instead.
 */
export class SystemClock implements Clock {
  now(): Date {
    return new Date();
  }

  nowInRestaurantTz(): Date {
    const base = new Date();
    return new Date(base.toLocaleString("en-US", { timeZone: env.RESTAURANT_TZ }));
  }
}
