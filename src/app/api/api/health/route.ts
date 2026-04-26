import { NextResponse } from "next/server";
import { db } from "@/lib/db";

// Liveness probe for UptimeRobot / any external monitor. Fails fast if
// the DB connection is broken so the monitor can page you before a
// customer does. Deliberately minimal: a single cheap query, no auth,
// no side effects.
export async function GET() {
  const startedAt = Date.now();
  try {
    await db.$queryRaw`SELECT 1`;
    return NextResponse.json(
      { ok: true, ms: Date.now() - startedAt },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "unknown" },
      { status: 503, headers: { "Cache-Control": "no-store" } }
    );
  }
}
