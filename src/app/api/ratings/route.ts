import { NextRequest, NextResponse } from "next/server";
import { useCases } from "@/infrastructure/composition";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { sessionId, food, service, hygiene, comment } = body;
    if (!sessionId) {
      return NextResponse.json({ error: "sessionId required" }, { status: 400 });
    }
    const rating = await useCases.submitRating.execute({
      sessionId,
      food: food || 0,
      service: service || 0,
      hygiene: hygiene || 0,
      comment: comment || null,
    });
    return NextResponse.json({
      id: rating.id,
      sessionId: rating.sessionId,
      food: rating.food,
      service: rating.service,
      hygiene: rating.hygiene,
      comment: rating.comment,
      createdAt: rating.createdAt,
    }, { status: 201 });
  } catch (err) {
    console.error("Rating save failed:", err);
    return NextResponse.json({ error: "Failed to save rating" }, { status: 500 });
  }
}
