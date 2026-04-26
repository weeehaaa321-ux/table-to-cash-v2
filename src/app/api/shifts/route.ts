import { NextResponse } from "next/server";
import { getCurrentShift, getShiftLabel, getShiftProgress } from "@/lib/shifts";

// GET: Current shift info
export async function GET() {
  const currentShift = getCurrentShift();
  return NextResponse.json({
    currentShift,
    label: getShiftLabel(currentShift),
    progress: Math.round(getShiftProgress()),
  });
}
