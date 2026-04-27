import { NextResponse } from "next/server";
import { useCases } from "@/infrastructure/composition";

// Current-shift info changes only at the 8-hour boundary. Brief CDN
// cache cuts the per-second polling cost dramatically without
// sacrificing accuracy on the boundary (60s SWR catches it).
export async function GET() {
  const currentShift = useCases.sessions.currentShift();
  return NextResponse.json(
    {
      currentShift,
      label: useCases.sessions.shiftLabel(currentShift),
      progress: Math.round(useCases.sessions.shiftProgress()),
    },
    {
      headers: {
        "Cache-Control": "public, s-maxage=30, stale-while-revalidate=60",
      },
    },
  );
}
