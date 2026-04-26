// ─────────────────────────────────────────────────────────────────
// StaffPin — value object for the 4-to-6 digit PIN used to authenticate
// staff. The PIN itself is NEVER stored in this object — only its
// hashed form (bcrypt) which lives on the Staff entity.
//
// Domain owns: validation rules (length, digits-only), comparison API.
// Infrastructure owns: bcrypt impl (lives in
//   infrastructure/auth/PinAuthenticator.ts) — domain doesn't depend on
//   bcryptjs.
// ─────────────────────────────────────────────────────────────────

const MIN_LENGTH = 4;
const MAX_LENGTH = 6;
const DIGITS_ONLY = /^[0-9]+$/;

export class StaffPin {
  private constructor(private readonly raw: string) {}

  static parse(raw: string): StaffPin {
    if (typeof raw !== "string") {
      throw new RangeError("StaffPin: must be a string");
    }
    const trimmed = raw.trim();
    if (trimmed.length < MIN_LENGTH || trimmed.length > MAX_LENGTH) {
      throw new RangeError(
        `StaffPin: length must be ${MIN_LENGTH}–${MAX_LENGTH} digits`,
      );
    }
    if (!DIGITS_ONLY.test(trimmed)) {
      throw new RangeError("StaffPin: must be digits only");
    }
    return new StaffPin(trimmed);
  }

  /**
   * Returns the raw PIN — only call this immediately before passing
   * to a hash function or to a comparison helper. Never log it,
   * never serialize it.
   */
  reveal(): string {
    return this.raw;
  }

  /**
   * Constant-time-ish equality for plaintext compares (rarely needed —
   * actual auth uses bcrypt). Avoids early-exit string compare.
   */
  equals(other: StaffPin): boolean {
    if (this.raw.length !== other.raw.length) return false;
    let diff = 0;
    for (let i = 0; i < this.raw.length; i++) {
      diff |= this.raw.charCodeAt(i) ^ other.raw.charCodeAt(i);
    }
    return diff === 0;
  }

  // Don't accidentally leak in logs.
  toString(): string {
    return "[REDACTED]";
  }
  toJSON(): string {
    return "[REDACTED]";
  }
}
