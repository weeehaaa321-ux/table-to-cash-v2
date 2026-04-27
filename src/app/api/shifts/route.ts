import { NextResponse } from "next/server";
import { useCases } from "@/infrastructure/composition";

export async function GET() {
  const currentShift = useCases.sessions.currentShift();
  return NextResponse.json({
    currentShift,
    label: useCases.sessions.shiftLabel(currentShift),
    progress: Math.round(useCases.sessions.shiftProgress()),
  });
}
