import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export async function POST(request: NextRequest) {
  try {
    const { endpoint } = await request.json();
    if (!endpoint) return NextResponse.json({ error: "endpoint required" }, { status: 400 });

    await db.pushSubscription.deleteMany({ where: { endpoint } });
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("Push unsubscribe failed:", err);
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}
