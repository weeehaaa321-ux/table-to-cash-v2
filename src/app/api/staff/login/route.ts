import { NextRequest, NextResponse } from "next/server";
import { useCases } from "@/infrastructure/composition";

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { pin, restaurantId } = body;
  if (!pin || !restaurantId) {
    return NextResponse.json({ error: "pin and restaurantId are required" }, { status: 400 });
  }
  try {
    const realId = await useCases.staffManagement.resolveRestaurantId(restaurantId);
    if (!realId) {
      return NextResponse.json({ error: "Restaurant not found" }, { status: 400 });
    }
    const result = await useCases.staffManagement.login(pin, realId);
    if (!result.ok) {
      return NextResponse.json({ error: result.reason }, { status: result.status });
    }
    return NextResponse.json(result.staff);
  } catch (err) {
    console.error("Staff login failed:", err);
    return NextResponse.json({ error: "Login failed" }, { status: 500 });
  }
}
