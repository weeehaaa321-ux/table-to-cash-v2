import { NextRequest, NextResponse } from "next/server";
import { useCases } from "@/infrastructure/composition";

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const result = await useCases.cron.runTableCheck();
    return NextResponse.json({ success: true, ...result });
  } catch (err) {
    console.error("Table check cron failed:", err);
    return NextResponse.json({ error: "Cron failed" }, { status: 500 });
  }
}
