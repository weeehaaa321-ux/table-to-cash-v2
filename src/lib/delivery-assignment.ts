import { db } from "@/lib/db";
import { sendPushToStaff } from "@/lib/web-push";

async function resolveRestaurantId(id: string): Promise<string | null> {
  if (!id) return null;
  if (id.startsWith("c") && id.length > 10) return id;
  const r = await db.restaurant.findUnique({ where: { slug: id }, select: { id: true } });
  return r?.id || null;
}

/**
 * Auto-assign a delivery order to the best available online driver.
 *
 * Priority:
 *  1. Only drivers who are online (deliveryOnline = true) and active
 *  2. Prefer drivers NOT currently serving a delivery (no active order)
 *  3. Among tied candidates, pick the one with fewest deliveries in last 24h
 *
 * Returns the assigned driverId, or null if no driver is available.
 */
export async function autoAssignDelivery(
  restaurantId: string,
  orderId: string
): Promise<string | null> {
  const realId = await resolveRestaurantId(restaurantId);
  if (!realId) return null;

  // 1. Find all online, active delivery drivers
  const drivers = await db.staff.findMany({
    where: {
      restaurantId: realId,
      role: "DELIVERY",
      active: true,
      deliveryOnline: true,
    },
    select: { id: true, name: true },
  });
  if (drivers.length === 0) return null;

  const driverIds = drivers.map((d) => d.id);

  // 2. Find which drivers have an active delivery right now
  //    (assigned but not yet delivered)
  const activeDeliveries = await db.order.groupBy({
    by: ["deliveryDriverId"],
    where: {
      deliveryDriverId: { in: driverIds },
      orderType: "DELIVERY",
      deliveryStatus: { in: ["ASSIGNED", "PICKED_UP", "ON_THE_WAY"] },
    },
    _count: true,
  });
  const activeMap = new Map<string, number>();
  for (const ad of activeDeliveries) {
    if (ad.deliveryDriverId) activeMap.set(ad.deliveryDriverId, ad._count);
  }

  // Separate into free drivers (no active delivery) and busy drivers
  const freeDrivers = drivers.filter((d) => !activeMap.has(d.id));
  const candidates = freeDrivers.length > 0 ? freeDrivers : drivers;

  // 3. Among candidates, pick the one with fewest deliveries in last 24h
  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const recentDeliveries = await db.order.groupBy({
    by: ["deliveryDriverId"],
    where: {
      deliveryDriverId: { in: candidates.map((c) => c.id) },
      orderType: "DELIVERY",
      createdAt: { gte: oneDayAgo },
    },
    _count: true,
  });
  const recentMap = new Map<string, number>();
  for (const rd of recentDeliveries) {
    if (rd.deliveryDriverId) recentMap.set(rd.deliveryDriverId, rd._count);
  }

  // Sort by fewest recent deliveries
  candidates.sort(
    (a, b) => (recentMap.get(a.id) || 0) - (recentMap.get(b.id) || 0)
  );

  const chosen = candidates[0];
  if (!chosen) return null;

  // 4. Atomically assign (only if still unassigned)
  const result = await db.order.updateMany({
    where: {
      id: orderId,
      deliveryDriverId: null,
    },
    data: {
      deliveryDriverId: chosen.id,
      deliveryStatus: "ASSIGNED",
    },
  });

  if (result.count === 0) return null; // Already claimed by someone else

  // 5. Notify the assigned driver
  const order = await db.order.findUnique({
    where: { id: orderId },
    select: { orderNumber: true },
  });

  sendPushToStaff(chosen.id, {
    title: "New Delivery Assigned",
    body: `Order #${order?.orderNumber ?? "?"} — pick up from kitchen`,
    tag: `delivery-${orderId}`,
    url: "/delivery",
  }).catch(() => {});

  return chosen.id;
}

/**
 * Try to assign all unassigned delivery orders to available drivers.
 * Called when a driver goes online or completes a delivery.
 */
export async function assignPendingDeliveries(restaurantId: string): Promise<void> {
  const realId = await resolveRestaurantId(restaurantId);
  if (!realId) return;

  const unassigned = await db.order.findMany({
    where: {
      restaurantId: realId,
      orderType: "DELIVERY",
      deliveryDriverId: null,
      status: { notIn: ["PENDING", "CANCELLED", "PAID"] },
    },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });

  for (const order of unassigned) {
    await autoAssignDelivery(restaurantId, order.id);
  }
}
