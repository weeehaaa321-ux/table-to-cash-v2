import { db } from "./db";
import { sendPushToStaff } from "./web-push";

// Move every OPEN session off `waiterId` onto another active waiter in
// the same restaurant, load-balanced by count. If nobody else is active
// the sessions are left unassigned (waiterId = null) so an on-shift
// waiter can pick them up manually.
//
// Only call this when the waiter is being removed from duty (shift end
// or manager turning them off). Do NOT call periodically — we never
// steal tables away from a waiter who is still working.
export async function transferWaiterSessions(
  waiterId: string,
  restaurantId: string
): Promise<{
  transferred: number;
  newWaiterId: string | null;
  newWaiterName: string | null;
  tables: number[];
}> {
  const openSessions = await db.tableSession.findMany({
    where: { waiterId, status: "OPEN" },
    include: { table: { select: { number: true } } },
  });

  if (openSessions.length === 0) {
    return { transferred: 0, newWaiterId: null, newWaiterName: null, tables: [] };
  }

  const tableNumbers = openSessions.map((s) => s.table?.number).filter((n): n is number => n != null);

  const otherWaiters = await db.staff.findMany({
    where: { restaurantId, role: "WAITER", active: true, id: { not: waiterId } },
    orderBy: { createdAt: "asc" },
  });

  if (otherWaiters.length === 0) {
    await db.tableSession.updateMany({
      where: { waiterId, status: "OPEN" },
      data: { waiterId: null },
    });
    return { transferred: openSessions.length, newWaiterId: null, newWaiterName: null, tables: tableNumbers };
  }

  const sessionCounts = await db.tableSession.groupBy({
    by: ["waiterId"],
    where: { restaurantId, status: "OPEN", waiterId: { in: otherWaiters.map((w) => w.id) } },
    _count: true,
  });
  const countMap = new Map<string, number>();
  for (const w of otherWaiters) countMap.set(w.id, 0);
  for (const sc of sessionCounts) {
    if (sc.waiterId) countMap.set(sc.waiterId, sc._count);
  }

  let minCount = Infinity;
  let targetWaiter = otherWaiters[0];
  for (const w of otherWaiters) {
    const n = countMap.get(w.id) || 0;
    if (n < minCount) {
      minCount = n;
      targetWaiter = w;
    }
  }

  await db.tableSession.updateMany({
    where: { waiterId, status: "OPEN" },
    data: { waiterId: targetWaiter.id },
  });

  try {
    await sendPushToStaff(targetWaiter.id, {
      title: "Tables Transferred to You",
      body: `You've been assigned Table${openSessions.length > 1 ? "s" : ""} ${tableNumbers.join(", ")}`,
      tag: `transfer-${Date.now()}`,
      url: "/waiter",
    });
  } catch {
    /* push not critical */
  }

  return {
    transferred: openSessions.length,
    newWaiterId: targetWaiter.id,
    newWaiterName: targetWaiter.name,
    tables: tableNumbers,
  };
}
