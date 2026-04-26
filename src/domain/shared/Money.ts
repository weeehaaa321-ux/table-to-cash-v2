// ─────────────────────────────────────────────────────────────────
// Money value object.
//
// Stores amounts as integer minor units (e.g. piasters for EGP, cents
// for USD) to avoid floating-point drift. All arithmetic happens at the
// integer level; conversion to/from Decimal happens at the boundaries.
//
// Currency is implicit: the system is single-tenant per deploy, so
// every Money value in the running process is in the restaurant's
// currency (RESTAURANT_CURRENCY env var). No currency tag is stored on
// the value itself — that would invite multi-currency math bugs.
//
// Source repo equivalents:
//   src/lib/money.ts                — string formatting helpers
//   prisma schema: Decimal(10, 2)   — DB representation
//
// Invariants:
//   - Internal value is a finite, non-negative integer (no negative money;
//     refunds are modeled as separate negative-direction operations on
//     other entities, not as negative Money values).
//   - 2 fractional digits exactly (matching DB's Decimal(10,2)).
//   - Max representable: 99,999,999.99 (10 digits, 2 fractional).
// ─────────────────────────────────────────────────────────────────

const FRACTION_DIGITS = 2;
const SCALE = 100; // 10 ** FRACTION_DIGITS
const MAX_MINOR = 9_999_999_999; // matches Decimal(10, 2)

export class Money {
  private constructor(private readonly minor: number) {}

  // ─── Construction ────────────────────────────────────────────

  static zero(): Money {
    return new Money(0);
  }

  /**
   * From an integer count of minor units (piasters/cents).
   * Throws on non-finite, non-integer, negative, or out-of-range.
   */
  static fromMinorUnits(minor: number): Money {
    if (!Number.isFinite(minor)) {
      throw new RangeError(`Money: minor units must be finite, got ${minor}`);
    }
    if (!Number.isInteger(minor)) {
      throw new RangeError(`Money: minor units must be integer, got ${minor}`);
    }
    if (minor < 0) {
      throw new RangeError(`Money: cannot be negative, got ${minor}`);
    }
    if (minor > MAX_MINOR) {
      throw new RangeError(`Money: exceeds Decimal(10,2) range, got ${minor}`);
    }
    return new Money(minor);
  }

  /**
   * From a decimal string like "12.34", "0.50", or "100".
   * Tolerates leading/trailing whitespace and trailing zeros.
   * Throws on malformed input or values that can't be represented exactly.
   */
  static fromDecimalString(input: string): Money {
    const trimmed = input.trim();
    if (!/^\d+(\.\d{1,})?$/.test(trimmed)) {
      throw new RangeError(`Money: malformed decimal string '${input}'`);
    }
    const [whole, frac = ""] = trimmed.split(".");
    if (frac.length > FRACTION_DIGITS) {
      // Anything more than 2 fractional digits is rejected — would lose
      // precision silently otherwise. Caller should round explicitly.
      const tail = frac.slice(FRACTION_DIGITS);
      if (!/^0+$/.test(tail)) {
        throw new RangeError(
          `Money: '${input}' has more than ${FRACTION_DIGITS} fractional digits with non-zero tail`,
        );
      }
    }
    const padded = frac.padEnd(FRACTION_DIGITS, "0").slice(0, FRACTION_DIGITS);
    const minor = Number(whole) * SCALE + Number(padded);
    return Money.fromMinorUnits(minor);
  }

  /**
   * From a JS number representing the major unit (e.g. 12.34 EGP).
   * Useful for hardcoded test values; avoid for money flowing from
   * external systems — use fromDecimalString for those to preserve
   * exact representation.
   */
  static fromNumber(amount: number): Money {
    if (!Number.isFinite(amount)) {
      throw new RangeError(`Money: amount must be finite, got ${amount}`);
    }
    // Round to nearest minor unit to absorb floating-point noise like
    // 0.1 + 0.2 = 0.30000000000000004.
    const minor = Math.round(amount * SCALE);
    return Money.fromMinorUnits(minor);
  }

  /**
   * From a Prisma Decimal-shaped value (anything with toString() that
   * yields a decimal string). Doesn't import Prisma — this is pure
   * domain code. Mappers in infrastructure/prisma/ pass `row.price`
   * directly; Decimal.toString() is a stable decimal representation.
   */
  static fromDecimalLike(d: { toString(): string }): Money {
    return Money.fromDecimalString(d.toString());
  }

  // ─── Arithmetic ──────────────────────────────────────────────

  add(other: Money): Money {
    return Money.fromMinorUnits(this.minor + other.minor);
  }

  /**
   * Subtraction floors at zero. Money never goes negative — if you
   * need to express a refund or shortage, use a different model
   * (e.g. CashSettlement.variance is a signed Decimal in the DB,
   * not a Money value object).
   */
  subtractClamped(other: Money): Money {
    const result = this.minor - other.minor;
    return Money.fromMinorUnits(result < 0 ? 0 : result);
  }

  /**
   * Multiply by an integer count (typical: line item price × quantity).
   * Use multiplyByPercent for fractional scaling (tax, discount).
   */
  multiplyByQuantity(quantity: number): Money {
    if (!Number.isInteger(quantity) || quantity < 0) {
      throw new RangeError(`Money.multiplyByQuantity: quantity must be a non-negative integer, got ${quantity}`);
    }
    return Money.fromMinorUnits(this.minor * quantity);
  }

  /**
   * Multiply by a percent (0–100). Result rounds half-up to nearest
   * minor unit to match the way receipts and DB reads behave.
   */
  multiplyByPercent(percent: number): Money {
    if (!Number.isFinite(percent) || percent < 0) {
      throw new RangeError(`Money.multiplyByPercent: percent must be a non-negative number, got ${percent}`);
    }
    return Money.fromMinorUnits(Math.round((this.minor * percent) / 100));
  }

  // ─── Comparison ──────────────────────────────────────────────

  equals(other: Money): boolean {
    return this.minor === other.minor;
  }

  isZero(): boolean {
    return this.minor === 0;
  }

  greaterThan(other: Money): boolean {
    return this.minor > other.minor;
  }

  greaterThanOrEqual(other: Money): boolean {
    return this.minor >= other.minor;
  }

  lessThan(other: Money): boolean {
    return this.minor < other.minor;
  }

  // ─── Serialization ───────────────────────────────────────────

  toMinorUnits(): number {
    return this.minor;
  }

  /**
   * Decimal string with exactly 2 fractional digits, e.g. "12.34".
   * Suitable for sending to Prisma's Decimal column or to JSON APIs.
   */
  toDecimalString(): string {
    const whole = Math.floor(this.minor / SCALE);
    const frac = this.minor % SCALE;
    return `${whole}.${frac.toString().padStart(FRACTION_DIGITS, "0")}`;
  }

  /**
   * For human display. Uses the source repo's pattern: integer if no
   * fractional part, else 2 decimals. Currency suffix added by caller
   * (presentation layer reads RESTAURANT_CURRENCY).
   */
  toDisplayString(): string {
    if (this.minor % SCALE === 0) {
      return String(this.minor / SCALE);
    }
    return this.toDecimalString();
  }

  toJSON(): string {
    return this.toDecimalString();
  }

  toString(): string {
    return this.toDecimalString();
  }
}

/**
 * Sum any number of Money values. Empty sum = zero.
 */
export function sumMoney(values: readonly Money[]): Money {
  return values.reduce((acc, m) => acc.add(m), Money.zero());
}
