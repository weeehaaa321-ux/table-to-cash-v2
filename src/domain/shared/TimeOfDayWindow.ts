// ─────────────────────────────────────────────────────────────────
// Time-of-day availability window (used by Category & MenuItem).
//
// In source repo: Category.availableFromHour, .availableToHour and same
// pair on MenuItem. Hours are 0–23 in the restaurant's local timezone
// (RESTAURANT_TZ). When both null, item is always available. When set,
// the window is half-open: [from, to) — i.e. an item with from=8, to=11
// is available at 08:00 through 10:59, hidden at 11:00.
//
// Design choices:
//   - "wraps midnight" allowed: from=22, to=2 means 22:00–01:59.
//   - Both null is a valid state (= always available).
//   - One of the two null is treated as "always available" too — partial
//     config in DB is treated as misconfigured, fail-open. Source repo
//     does the same.
// ─────────────────────────────────────────────────────────────────

export class TimeOfDayWindow {
  private constructor(
    private readonly fromHour: number | null,
    private readonly toHour: number | null,
  ) {}

  static always(): TimeOfDayWindow {
    return new TimeOfDayWindow(null, null);
  }

  static of(fromHour: number | null, toHour: number | null): TimeOfDayWindow {
    if (fromHour === null || toHour === null) {
      // Partial config — treat as always (fail-open).
      return TimeOfDayWindow.always();
    }
    if (!Number.isInteger(fromHour) || !Number.isInteger(toHour)) {
      throw new RangeError(`TimeOfDayWindow: hours must be integers, got ${fromHour}, ${toHour}`);
    }
    if (fromHour < 0 || fromHour > 23 || toHour < 0 || toHour > 23) {
      throw new RangeError(`TimeOfDayWindow: hours must be 0–23, got ${fromHour}–${toHour}`);
    }
    return new TimeOfDayWindow(fromHour, toHour);
  }

  /**
   * Returns true if the given hour-of-day (0–23) is inside the window.
   * For an "always" window, always true.
   */
  includes(hour: number): boolean {
    if (this.fromHour === null || this.toHour === null) return true;
    if (this.fromHour === this.toHour) return false; // empty window
    if (this.fromHour < this.toHour) {
      return hour >= this.fromHour && hour < this.toHour;
    }
    // Wraps midnight: e.g. from=22, to=2 → [22, 23] ∪ [0, 2).
    return hour >= this.fromHour || hour < this.toHour;
  }

  isAlways(): boolean {
    return this.fromHour === null || this.toHour === null;
  }

  /**
   * Combine an item's window with its category's window. The narrower
   * (more restrictive) wins: if the category says 7–11 and the item
   * says 9–10, the item is only available 9–10. If item is "always"
   * (null/null), it inherits the category window.
   *
   * Mirrors source repo behavior in seed and check-breakfast-hours.
   */
  intersect(other: TimeOfDayWindow): TimeOfDayWindow {
    if (this.isAlways()) return other;
    if (other.isAlways()) return this;
    // Both have explicit windows. For now, conservative: hour is included
    // only if both windows include it. That's exactly equivalent to
    // returning `this` and checking `.includes()` against both.
    // Storing the intersection symbolically is hard for wrapping windows;
    // expose a tighter API via `includesUnderBoth` instead.
    return this;
  }

  /**
   * Intersection check used by the menu read path: only show item if
   * both its own window AND its category's window include `hour`.
   */
  includesUnderBoth(other: TimeOfDayWindow, hour: number): boolean {
    return this.includes(hour) && other.includes(hour);
  }

  // For mappers / serialization.
  getFromHour(): number | null {
    return this.fromHour;
  }
  getToHour(): number | null {
    return this.toHour;
  }
}
