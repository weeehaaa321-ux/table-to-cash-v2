import { NextRequest, NextResponse } from "next/server";
import { useCases } from "@/infrastructure/composition";

// Vercel Cron entrypoint. Closes every open StaffShift whose scheduled
// end time is more than 1 hour in the past. Staff cannot clock out
// manually — this cron is the only path that closes a shift.
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const result = await useCases.cron.runAutoClockOut();
    return NextResponse.json({ success: true, ...result });
  } catch (err) {
    console.error("Auto clock-out cron failed:", err);
    return NextResponse.json({ error: "Cron failed" }, { status: 500 });
  }
}
