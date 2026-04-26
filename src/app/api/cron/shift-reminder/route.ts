import { NextRequest, NextResponse } from "next/server";
import { useCases } from "@/infrastructure/composition";

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const result = await useCases.cron.runShiftReminder();
    return NextResponse.json(result);
  } catch (err) {
    console.error("Shift reminder cron failed:", err);
    return NextResponse.json({ error: "Cron failed" }, { status: 500 });
  }
}
