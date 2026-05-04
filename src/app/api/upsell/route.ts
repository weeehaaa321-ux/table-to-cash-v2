import { NextRequest, NextResponse } from "next/server";
import { useCases } from "@/infrastructure/composition";

// POST /api/upsell
//
// Body: {
//   restaurantId: string,                                    // slug or id
//   cart: { menuItemId: string, quantity: number }[],
//   sessionId?: string                                       // optional, sharpens scoring
// }
//
// Returns up to 3 ranked suggestions:
//   { suggestions: [{ itemId, score, reason, subtext, bucket }] }
//
// Stateless from the client's view — call as often as the cart changes.
// The engine is pure, so the cost is a single menu read + (optional)
// a session-scoped order read. No writes.
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const { restaurantId, cart, sessionId } = body as {
      restaurantId?: string;
      cart?: { menuItemId: string; quantity: number }[];
      sessionId?: string;
    };

    if (!restaurantId) {
      return NextResponse.json({ error: "restaurantId required" }, { status: 400 });
    }
    const realId = await useCases.upsell.resolveRestaurantId(restaurantId);
    if (!realId) {
      return NextResponse.json({ suggestions: [] });
    }
    // Tolerate odd inputs — empty cart is fine, we'll suggest opener
    // items; non-array cart degrades to empty.
    const cleanCart = Array.isArray(cart)
      ? cart
          .filter((c) => c && typeof c.menuItemId === "string" && c.menuItemId.length > 0)
          .map((c) => ({
            menuItemId: c.menuItemId,
            quantity: typeof c.quantity === "number" && c.quantity > 0 ? Math.min(c.quantity, 99) : 1,
          }))
      : [];

    const suggestions = await useCases.upsell.suggestForCart({
      restaurantId: realId,
      cart: cleanCart,
      sessionId: typeof sessionId === "string" && sessionId.length > 0 ? sessionId : null,
    });

    return NextResponse.json({ suggestions });
  } catch (err) {
    console.error("Upsell ranking failed:", err);
    return NextResponse.json({ suggestions: [] }, { status: 500 });
  }
}
