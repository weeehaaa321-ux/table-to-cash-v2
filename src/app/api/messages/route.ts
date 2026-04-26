import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { sendPushToStaff, sendPushToRole, sendPushToRestaurant } from "@/lib/web-push";

// Resolve restaurantId — could be a slug or a cuid
async function resolveRestaurantId(id: string): Promise<string | null> {
  if (!id) return null;
  if (id.startsWith("c") && id.length > 10) return id;
  const restaurant = await db.restaurant.findUnique({
    where: { slug: id },
    select: { id: true },
  });
  return restaurant?.id || null;
}

// POST — send a message (staff or guest call_waiter)
export async function POST(request: NextRequest) {
  const body = await request.json();

  try {
    const restaurantId = await resolveRestaurantId(
      body.restaurantId || process.env.NEXT_PUBLIC_RESTAURANT_SLUG || "neom-dahab"
    );
    if (!restaurantId) {
      return NextResponse.json({ error: "Restaurant not found" }, { status: 400 });
    }

    const msg = await db.message.create({
      data: {
        type: body.type || "alert",
        from: body.from || "owner",
        to: body.to || "all",
        text: body.text || null,
        audio: body.audio || null,
        tableId: body.tableId || null,
        orderId: body.orderId || null,
        command: body.command || null,
        restaurantId,
      },
    });

    // Send push notification (skip if caller already sent one, e.g. cash payment)
    if (!body.skipPush) {
      if (body.command === "call_waiter" && body.tableId) {
        const pushPayload = {
          title: `Table ${body.tableId} — Needs Attention`,
          body: body.text || `Table ${body.tableId} is calling the waiter`,
          tag: `call-waiter-${body.tableId}-${Date.now()}`,
          url: "/waiter",
        };
        try {
          const session = await db.tableSession.findFirst({
            where: { table: { number: body.tableId, restaurantId }, status: "OPEN" },
            select: { waiterId: true },
          });
          if (session?.waiterId) {
            sendPushToStaff(session.waiterId, pushPayload).catch(() => {});
          } else {
            sendPushToRole("WAITER", restaurantId, pushPayload).catch(() => {});
          }
        } catch {
          sendPushToRole("WAITER", restaurantId, pushPayload).catch(() => {});
        }
      } else {
        const pushPayload = {
          title: body.type === "voice" ? "Voice Note" : body.command === "cash_payment" ? "Cash Collection" : "Message",
          body: body.text || "New message from manager",
          tag: `msg-${msg.id}`,
          url: "/waiter",
        };
        if (msg.to === "all") {
          sendPushToRestaurant(restaurantId, pushPayload).catch(() => {});
        } else if (msg.to === "kitchen") {
          sendPushToRole("KITCHEN", restaurantId, pushPayload).catch(() => {});
        } else {
          sendPushToStaff(msg.to, pushPayload).catch(() => {});
        }
      }
    }

    // Resolve sender + recipient display names so the client doesn't
    // have to do its own lookup. Guests / owner / "all" pass through.
    const isCuid = (v: string | null | undefined): v is string =>
      !!v && v.startsWith("c") && v.length > 10;
    const ids = [msg.from, msg.to].filter(isCuid);
    const rows = ids.length > 0
      ? await db.staff.findMany({
          where: { id: { in: ids } },
          select: { id: true, name: true },
        })
      : [];
    const nameById = new Map(rows.map((s) => [s.id, s.name]));

    return NextResponse.json({
      ...msg,
      fromName: nameById.get(msg.from) || msg.from,
      toName: nameById.get(msg.to) || msg.to,
      createdAt: msg.createdAt.getTime(),
    }, { status: 201 });
  } catch (err) {
    console.error("Failed to create message:", err);
    return NextResponse.json({ error: "Failed to send message" }, { status: 500 });
  }
}

// GET — staff poll for new messages
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const since = parseInt(url.searchParams.get("since") || "0", 10);
  const to = url.searchParams.get("to");
  const restaurantId = url.searchParams.get("restaurantId");

  try {
    const realId = restaurantId
      ? await resolveRestaurantId(restaurantId)
      : null;

    const sinceDate = new Date(since);
    const toFilter = to ? { in: ["all", to] } : undefined;

    const messages = await db.message.findMany({
      where: {
        createdAt: { gt: sinceDate },
        ...(realId ? { restaurantId: realId } : {}),
        ...(toFilter ? { to: toFilter } : {}),
      },
      orderBy: { createdAt: "asc" },
      take: 50,
    });

    // Resolve sender AND recipient display names. Both `from` and `to`
    // are stored as staff ids (cuids) for staff-targeted messages; the
    // UI would otherwise render raw ids next to each message. `to` can
    // also be the literal "all" or a role keyword — those pass through.
    const isCuid = (v: string | null | undefined): v is string =>
      !!v && v.startsWith("c") && v.length > 10;
    const staffIds = Array.from(
      new Set(
        messages.flatMap((m) => [m.from, m.to]).filter(isCuid),
      ),
    );
    const staffRows = staffIds.length > 0
      ? await db.staff.findMany({
          where: { id: { in: staffIds } },
          select: { id: true, name: true },
        })
      : [];
    const nameById = new Map(staffRows.map((s) => [s.id, s.name]));

    return NextResponse.json(
      messages.map((m) => ({
        ...m,
        fromName: nameById.get(m.from) || m.from,
        toName: nameById.get(m.to) || m.to,
        createdAt: m.createdAt.getTime(),
      }))
    );
  } catch (err) {
    console.error("Failed to fetch messages:", err);
    return NextResponse.json({ error: "Failed to fetch messages" }, { status: 500 });
  }
}
