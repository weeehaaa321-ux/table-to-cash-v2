import { NextRequest, NextResponse } from "next/server";
import { useCases } from "@/infrastructure/composition";
import { readWaiterAppEnabled } from "@/application/session/SessionUseCases";

// ─── In-memory rate limit ──────────────────────────────────────
//
// Why in-memory and not Redis: Vercel serverless function instances
// stay warm for several minutes between cold starts, so a Map at
// module scope survives across requests on the same instance. An
// attacker would need to fan a brute-force attempt across many
// instances to dodge the limit, which dramatically raises the cost
// of the attack vs. the original "fire 10 000 PINs at one URL"
// scenario. Combined with the 350 ms baseline delay below, this
// gets a 4-digit PIN brute-force from "minutes" to "hours of
// distributed effort" without a Redis/Upstash dependency.
//
// IP source: x-forwarded-for first hop, or x-real-ip, or
// fallback to a coarse bucket. On Vercel x-forwarded-for is
// trustworthy because the platform sets it.
type Bucket = { failures: number; firstAt: number; blockedUntil: number };
const RL_WINDOW_MS = 5 * 60 * 1000;        // 5 minutes
const RL_MAX_FAILURES = 8;                 // before block
const RL_BLOCK_MS = 15 * 60 * 1000;        // 15 minutes
const RL_BASELINE_DELAY_MS = 350;          // applied to every attempt
const buckets = new Map<string, Bucket>();

function getIp(req: NextRequest): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0]?.trim() || "unknown";
  return req.headers.get("x-real-ip") || "unknown";
}

function checkAndConsume(ip: string): { allowed: true } | { allowed: false; retryAfterSec: number } {
  const now = Date.now();
  // Sweep stale buckets opportunistically (no separate cron needed).
  if (buckets.size > 1000) {
    for (const [k, b] of buckets) {
      if (b.blockedUntil < now && now - b.firstAt > RL_WINDOW_MS) buckets.delete(k);
    }
  }
  const b = buckets.get(ip);
  if (b && b.blockedUntil > now) {
    return { allowed: false, retryAfterSec: Math.ceil((b.blockedUntil - now) / 1000) };
  }
  return { allowed: true };
}

function recordFailure(ip: string): void {
  const now = Date.now();
  const b = buckets.get(ip);
  if (!b || now - b.firstAt > RL_WINDOW_MS) {
    buckets.set(ip, { failures: 1, firstAt: now, blockedUntil: 0 });
    return;
  }
  b.failures += 1;
  if (b.failures >= RL_MAX_FAILURES) {
    b.blockedUntil = now + RL_BLOCK_MS;
  }
}

function recordSuccess(ip: string): void {
  // Successful login clears the failure counter for this IP — a
  // legitimate cashier who fat-fingered twice shouldn't get locked
  // because of their own typos plus their teammate's typos.
  buckets.delete(ip);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function POST(request: NextRequest) {
  const ip = getIp(request);

  const gate = checkAndConsume(ip);
  if (!gate.allowed) {
    return NextResponse.json(
      { error: "Too many failed attempts. Try again later." },
      { status: 429, headers: { "Retry-After": String(gate.retryAfterSec) } },
    );
  }

  // Baseline delay on every attempt. Slows automated brute-force
  // from "10 000 attempts in seconds" to "10 000 attempts in ~58
  // minutes of constant requests" — and the rate limit above
  // catches any sustained attacker well before that.
  await sleep(RL_BASELINE_DELAY_MS);

  const body = await request.json();
  const { pin, restaurantId } = body;
  if (!pin || !restaurantId) {
    return NextResponse.json({ error: "pin and restaurantId are required" }, { status: 400 });
  }
  try {
    const realId = await useCases.staffManagement.resolveRestaurantId(restaurantId);
    if (!realId) {
      // Treat unknown restaurant as a soft failure for the rate
      // limiter — an attacker probing slugs shouldn't get free
      // attempts from a 404.
      recordFailure(ip);
      return NextResponse.json({ error: "Restaurant not found" }, { status: 400 });
    }
    const result = await useCases.staffManagement.login(pin, realId);
    if (!result.ok) {
      recordFailure(ip);
      return NextResponse.json({ error: result.reason }, { status: result.status });
    }
    recordSuccess(ip);
    // Surface the waiter-app flag so the role pages can short-circuit
    // login when their app is disabled for this restaurant.
    const waiterAppEnabled = await readWaiterAppEnabled(realId);
    return NextResponse.json({
      ...result.staff,
      waiterAppEnabled,
    });
  } catch (err) {
    console.error("Staff login failed:", err);
    return NextResponse.json({ error: "Login failed" }, { status: 500 });
  }
}
