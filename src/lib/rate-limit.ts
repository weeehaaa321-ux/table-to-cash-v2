import { NextRequest } from "next/server";

/**
 * Lightweight in-memory IP-bucket rate limiter. Pattern lifted from
 * src/app/api/staff/login/route.ts. Why in-memory: Vercel serverless
 * instances stay warm for a few minutes between cold starts, so a
 * Map at module scope survives across requests on the same instance.
 * Combined with a small baseline delay this makes brute-force /
 * spam expensive without pulling in Redis. For an attack distributed
 * across many instances the limit is per-instance, which is still
 * a meaningful bar at small scale.
 *
 * Caller passes a `bucket` name so different endpoints have separate
 * counters (e.g. /book/reserve and /book/availability share an IP
 * but each gets its own quota).
 */

type Bucket = { count: number; firstAt: number; blockedUntil: number };
type BucketMap = Map<string, Bucket>;

const stores = new Map<string, BucketMap>();

function storeFor(name: string): BucketMap {
  let s = stores.get(name);
  if (!s) {
    s = new Map();
    stores.set(name, s);
  }
  return s;
}

function getIp(req: NextRequest): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0]?.trim() || "unknown";
  return req.headers.get("x-real-ip") || "unknown";
}

export type RateLimitConfig = {
  /** Stable name for the bucket store (e.g. "book-reserve"). */
  bucket: string;
  /** Window length in ms. */
  windowMs: number;
  /** Hits allowed in the window before we block. */
  max: number;
  /** When blocked, how long (ms) the IP stays blocked. */
  blockMs?: number;
};

/**
 * Returns { allowed: true } when the request is within the limit.
 * When over the limit, returns { allowed: false, retryAfterSec }.
 * Counter is incremented on every call regardless — caller can
 * decide whether to skip incrementing for read-only endpoints.
 */
export function rateLimit(
  request: NextRequest,
  config: RateLimitConfig
): { allowed: true } | { allowed: false; retryAfterSec: number } {
  const ip = getIp(request);
  const store = storeFor(config.bucket);
  const now = Date.now();
  const blockMs = config.blockMs ?? config.windowMs;

  // Sweep stale entries opportunistically so the Map doesn't grow
  // unbounded for long-lived instances.
  if (store.size > 1000) {
    for (const [k, b] of store) {
      if (b.blockedUntil < now && now - b.firstAt > config.windowMs) {
        store.delete(k);
      }
    }
  }

  let b = store.get(ip);
  if (!b || now - b.firstAt > config.windowMs) {
    b = { count: 1, firstAt: now, blockedUntil: 0 };
    store.set(ip, b);
    return { allowed: true };
  }
  if (b.blockedUntil > now) {
    return {
      allowed: false,
      retryAfterSec: Math.ceil((b.blockedUntil - now) / 1000),
    };
  }
  b.count += 1;
  if (b.count > config.max) {
    b.blockedUntil = now + blockMs;
    return {
      allowed: false,
      retryAfterSec: Math.ceil(blockMs / 1000),
    };
  }
  return { allowed: true };
}
