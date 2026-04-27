import { NextRequest, NextResponse } from "next/server";
import { legacyDb as db } from "@/infrastructure/composition";

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

// POST: Clear all orders, sessions, and messages for a restaurant
// Used for fresh start or end-of-shift cleanup
// With goLive: true — wipes ALL transactional data for a clean production start
export async function POST(request: NextRequest) {
  const body = await request.json();
  const { restaurantId, shiftOnly, goLive } = body;

  if (!restaurantId) {
    return NextResponse.json({ error: "restaurantId required" }, { status: 400 });
  }

  try {
    const realId = await resolveRestaurantId(restaurantId);
    if (!realId) {
      return NextResponse.json({ error: "Restaurant not found" }, { status: 400 });
    }

    if (goLive) {
      return await handleGoLive(realId);
    }

    let since: Date | undefined;
    if (shiftOnly) {
      since = new Date();
      since.setHours(0, 0, 0, 0);
    }

    const where = since
      ? { restaurantId: realId, createdAt: { gte: since } }
      : { restaurantId: realId };

    const sessionWhere = since
      ? { restaurantId: realId, openedAt: { gte: since } }
      : { restaurantId: realId };

    const messageWhere = since
      ? { restaurantId: realId, createdAt: { gte: since } }
      : { restaurantId: realId };

    // Delete in order respecting foreign keys:
    // ratings → order items → orders → settlements → sessions → messages

    const sessions = await db.tableSession.findMany({
      where: sessionWhere,
      select: { id: true },
    });
    const sessionIds = sessions.map((s) => s.id);

    let deletedRatings = { count: 0 };
    if (sessionIds.length > 0) {
      deletedRatings = await db.rating.deleteMany({
        where: { sessionId: { in: sessionIds } },
      });
    }

    const orders = await db.order.findMany({
      where,
      select: { id: true },
    });
    const orderIds = orders.map((o) => o.id);

    if (orderIds.length > 0) {
      await db.orderItem.deleteMany({
        where: { orderId: { in: orderIds } },
      });
    }

    const deletedOrders = await db.order.deleteMany({ where });

    const deletedSettlements = await db.cashSettlement.deleteMany({
      where: since
        ? { restaurantId: realId, requestedAt: { gte: since } }
        : { restaurantId: realId },
    });

    if (sessionIds.length > 0) {
      await db.joinRequest.deleteMany({
        where: { sessionId: { in: sessionIds } },
      }).catch(() => {});
    }

    const deletedSessions = await db.tableSession.deleteMany({ where: sessionWhere });

    const deletedMessages = await db.message.deleteMany({ where: messageWhere });

    return NextResponse.json({
      success: true,
      deleted: {
        orders: deletedOrders.count,
        sessions: deletedSessions.count,
        messages: deletedMessages.count,
        ratings: deletedRatings.count,
        settlements: deletedSettlements.count,
      },
    });
  } catch (err) {
    console.error("Clear failed:", err);
    return NextResponse.json({ error: "Failed to clear data" }, { status: 500 });
  }
}

async function handleGoLive(restaurantId: string) {
  try {
    const sessions = await db.tableSession.findMany({
      where: { restaurantId },
      select: { id: true },
    });
    const sessionIds = sessions.map((s) => s.id);

    const orders = await db.order.findMany({
      where: { restaurantId },
      select: { id: true },
    });
    const orderIds = orders.map((o) => o.id);

    const deleted: Record<string, number> = {};

    if (sessionIds.length > 0) {
      const r = await db.rating.deleteMany({ where: { sessionId: { in: sessionIds } } });
      deleted.ratings = r.count;
      const j = await db.joinRequest.deleteMany({ where: { sessionId: { in: sessionIds } } }).catch(() => ({ count: 0 }));
      deleted.joinRequests = j.count;
    }

    if (orderIds.length > 0) {
      const oi = await db.orderItem.deleteMany({ where: { orderId: { in: orderIds } } });
      deleted.orderItems = oi.count;
    }

    const o = await db.order.deleteMany({ where: { restaurantId } });
    deleted.orders = o.count;

    const cs = await db.cashSettlement.deleteMany({ where: { restaurantId } });
    deleted.settlements = cs.count;

    const ts = await db.tableSession.deleteMany({ where: { restaurantId } });
    deleted.sessions = ts.count;

    const msg = await db.message.deleteMany({ where: { restaurantId } });
    deleted.messages = msg.count;

    const cd = await db.cashDrawer.deleteMany({ where: { restaurantId } });
    deleted.cashDrawers = cd.count;

    const ss = await db.staffShift.deleteMany({ where: { restaurantId } });
    deleted.staffShifts = ss.count;

    const dc = await db.dailyClose.deleteMany({ where: { restaurantId } });
    deleted.dailyCloses = dc.count;

    const ps = await db.pushSubscription.deleteMany({
      where: { staff: { restaurantId } },
    });
    deleted.pushSubscriptions = ps.count;

    const vip = await db.vipGuest.deleteMany({ where: { restaurantId } });
    deleted.vipGuests = vip.count;

    return NextResponse.json({ success: true, goLive: true, deleted });
  } catch (err) {
    console.error("Go-live reset failed:", err);
    return NextResponse.json({ error: "Go-live reset failed" }, { status: 500 });
  }
}
