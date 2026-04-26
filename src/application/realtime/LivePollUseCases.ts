// /api/live-snapshot and /api/guest-poll — polled "real-time" data
// for kitchen / floor / guest screens. Pure read-only aggregations.

import { db } from "@/lib/db";

export class LivePollUseCases {
  /** Owner / floor manager dashboard snapshot. */
  async liveSnapshot(restaurantId: string) {
    const [orders, sessions, staff] = await Promise.all([
      db.order.findMany({
        where: {
          restaurantId,
          status: { in: ["PENDING", "CONFIRMED", "PREPARING", "READY"] },
        },
        include: { items: true, table: { select: { number: true } } },
        take: 100,
      }),
      db.tableSession.findMany({
        where: { restaurantId, status: "OPEN" },
        include: { table: { select: { number: true } } },
      }),
      db.staff.findMany({
        where: { restaurantId, active: true },
        select: { id: true, name: true, role: true, shift: true },
      }),
    ]);
    return { orders, sessions, staff };
  }

  /** Guest poll — single-session view used by the /track and /cart pages. */
  async guestPoll(sessionId: string, restaurantId: string) {
    const [session, orders, joinRequests] = await Promise.all([
      db.tableSession.findUnique({
        where: { id: sessionId },
        select: { id: true, status: true, guestCount: true, vipGuestId: true },
      }),
      db.order.findMany({
        where: { sessionId, restaurantId },
        include: {
          items: { include: { menuItem: { select: { name: true, image: true } } } },
        },
        orderBy: { createdAt: "asc" },
      }),
      db.joinRequest.findMany({
        where: { sessionId, status: "PENDING" },
      }),
    ]);
    return { session, orders, joinRequests };
  }
}
