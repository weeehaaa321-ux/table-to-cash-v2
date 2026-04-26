import { NextRequest, NextResponse } from "next/server";
import { useCases } from "@/infrastructure/composition";

export async function POST(request: NextRequest) {
  try {
    const { endpoint } = await request.json();
    if (!endpoint) return NextResponse.json({ error: "endpoint required" }, { status: 400 });
    await useCases.pushSubs.unsubscribe(endpoint);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("Push unsubscribe failed:", err);
    return NextResponse.json({ error: "Unsubscribe failed" }, { status: 500 });
  }
}
