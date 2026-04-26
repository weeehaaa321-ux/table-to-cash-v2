// Discriminated-union result type for operations that can fail without
// throwing. Use throw for programmer errors; Result<E, T> for expected
// failure modes (validation, business-rule violations, missing entities).

export type Result<E, T> =
  | { ok: true; value: T }
  | { ok: false; error: E };

export const ok = <T>(value: T): Result<never, T> => ({ ok: true, value });
export const err = <E>(error: E): Result<E, never> => ({ ok: false, error });

export function isOk<E, T>(r: Result<E, T>): r is { ok: true; value: T } {
  return r.ok;
}
export function isErr<E, T>(r: Result<E, T>): r is { ok: false; error: E } {
  return !r.ok;
}
