import { NextResponse } from "next/server";
import { useCases } from "@/infrastructure/composition";

// Liveness probe for UptimeRobot / any external monitor. Fails fast if
// the DB connection is broken so the monitor can page you before a
// customer does.
export async function GET() {
  const startedAt = Date.now();
  try {
    await useCases.admin.ping();
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
