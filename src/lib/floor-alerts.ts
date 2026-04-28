import type { TableState, LiveOrder } from "@/lib/engine/perception";
import { getOrderLabel } from "@/lib/order-label";

export type AlertSeverity = "critical" | "warning" | "info";

export type FloorAlertType =
  | "order_stuck"
  | "order_ready_uncollected"
  | "call_waiter_unanswered"
  | "waiter_overloaded"
  | "table_idle"
  | "session_no_waiter"
  | "kitchen_bottleneck"
  | "payment_pending"
  | "large_party"
  | "delivery_unassigned"
  | "delivery_late";

export type FloorAlert = {
  id: string;
  type: FloorAlertType;
  severity: AlertSeverity;
  tableNumber?: number | null;
  waiterId?: string;
  waiterName?: string;
  orderId?: string;
  message: string;
  since: number;
  suggestedAction: string;
};

type SessionInfo = {
  id: string;
  tableNumber: number | null;
  waiterId?: string | null;
  waiterName?: string | null;
  guestCount: number;
  status: string;
  openedAt: string;
  menuOpenedAt?: string | null;
  orderCount?: number;
  orderTotal?: number;
  unpaidTotal?: number;
  orderType?: string;
};

type StaffInfo = {
  id: string;
  name: string;
  role: string;
  shift: number;
};

const MINUTE = 60_000;

export function generateFloorAlerts(
  tables: TableState[],
  orders: LiveOrder[],
  sessions: SessionInfo[],
  staff: StaffInfo[],
  kitchenCapacity: number,
  now: number = Date.now()
): FloorAlert[] {
  const alerts: FloorAlert[] = [];
  const openSessions = sessions.filter((s) => s.status === "OPEN" && s.tableNumber != null && s.orderType !== "DELIVERY" && s.orderType !== "VIP_DINE_IN");
  const activeOrders = orders.filter((o) => o.status !== "paid" && o.status !== "cancelled" && o.orderType !== "DELIVERY");
  const onShiftWaiters = staff.filter((s) => s.role === "WAITER" && s.shift > 0);

  // Waiter → table count map
  const waiterTableCount = new Map<string, number>();
  const waiterNames = new Map<string, string>();
  for (const s of openSessions) {
    if (s.waiterId) {
      waiterTableCount.set(s.waiterId, (waiterTableCount.get(s.waiterId) || 0) + 1);
    }
  }
  for (const w of onShiftWaiters) {
    waiterNames.set(w.id, w.name);
    if (!waiterTableCount.has(w.id)) waiterTableCount.set(w.id, 0);
  }

  // --- Order-level alerts ---
  for (const order of activeOrders) {
    const age = now - order.createdAt;
    const session = openSessions.find((s) => s.tableNumber === order.tableNumber);

    if (order.status === "preparing" && age > 15 * MINUTE) {
      alerts.push({
        id: `stuck-${order.id}`,
        type: "order_stuck",
        severity: "critical",
        tableNumber: order.tableNumber,
        orderId: order.id,
        message: `Order #${order.orderNumber} (${getOrderLabel(order)}) stuck in kitchen — ${Math.round(age / MINUTE)} min`,
        since: order.createdAt,
        suggestedAction: "Ping kitchen",
      });
    }

    if (order.status === "ready") {
      const readyAge = order.readyAt ? now - order.readyAt : age;
      if (readyAge > 5 * MINUTE) {
        alerts.push({
          id: `uncollected-${order.id}`,
          type: "order_ready_uncollected",
          severity: "critical",
          tableNumber: order.tableNumber,
          orderId: order.id,
          waiterId: session?.waiterId || undefined,
          waiterName: session?.waiterId ? waiterNames.get(session.waiterId) || undefined : undefined,
          message: `Order #${order.orderNumber} (${getOrderLabel(order)}) ready but uncollected — ${Math.round(readyAge / MINUTE)} min`,
          since: order.readyAt || order.createdAt,
          suggestedAction: "Send waiter",
        });
      }
    }

  }

  // --- Session-level alerts ---
  for (const session of openSessions) {
    const openedAt = new Date(session.openedAt).getTime();
    const sessionAge = now - openedAt;
    const hasOrders = activeOrders.some((o) => o.tableNumber === session.tableNumber);

    if (!session.waiterId) {
      alerts.push({
        id: `no-waiter-${session.id}`,
        type: "session_no_waiter",
        severity: "warning",
        tableNumber: session.tableNumber,
        message: `Table ${session.tableNumber} has no waiter assigned`,
        since: openedAt,
        suggestedAction: "Assign waiter",
      });
    }

    if (!hasOrders && sessionAge > 5 * MINUTE) {
      alerts.push({
        id: `idle-${session.id}`,
        type: "table_idle",
        severity: "warning",
        tableNumber: session.tableNumber,
        waiterId: session.waiterId || undefined,
        waiterName: session.waiterId ? waiterNames.get(session.waiterId) || undefined : undefined,
        message: `Table ${session.tableNumber} open ${Math.round(sessionAge / MINUTE)} min — no orders`,
        since: openedAt,
        suggestedAction: "Check on table",
      });
    }

    if (session.guestCount >= 4 && !hasOrders && sessionAge > 3 * MINUTE) {
      alerts.push({
        id: `large-party-${session.id}`,
        type: "large_party",
        severity: "info",
        tableNumber: session.tableNumber,
        message: `Large party (${session.guestCount} guests) at table ${session.tableNumber} — no orders yet`,
        since: openedAt,
        suggestedAction: "Send waiter",
      });
    }
  }

  // --- Waiter-level alerts ---
  for (const [waiterId, count] of waiterTableCount) {
    const name = waiterNames.get(waiterId) || "Unknown";
    if (count >= 5) {
      alerts.push({
        id: `overloaded-${waiterId}`,
        type: "waiter_overloaded",
        severity: "warning",
        waiterId,
        waiterName: name,
        message: `${name} has ${count} active tables`,
        since: now,
        suggestedAction: "Reassign tables",
      });
    }
    // Note: we used to emit a `waiter_idle` alert when an on-shift waiter
    // had zero tables. Removed — the auto-assignment logic hands out
    // sessions as they arrive, so an idle waiter on a quiet moment isn't
    // an exception worth paging a floor manager about. The Staff Radar
    // still shows their idle load state for context.
  }

  // --- Delivery alerts ---
  const deliveryOrders = orders.filter((o) => o.orderType === "DELIVERY" && o.status !== "paid" && o.status !== "cancelled");
  for (const order of deliveryOrders) {
    if (order.status === "ready" && !order.deliveryStatus) {
      const readyAge = order.readyAt ? now - order.readyAt : now - order.createdAt;
      alerts.push({
        id: `delivery-unassigned-${order.id}`,
        type: "delivery_unassigned",
        severity: readyAge > 5 * MINUTE ? "critical" : "warning",
        orderId: order.id,
        message: `Delivery #${order.orderNumber} (${order.vipGuestName || "VIP"}) ready but no driver assigned — ${Math.round(readyAge / MINUTE)} min`,
        since: order.readyAt || order.createdAt,
        suggestedAction: "Assign driver",
      });
    }
    if (order.deliveryStatus === "ON_THE_WAY") {
      const age = now - order.createdAt;
      if (age > 30 * MINUTE) {
        alerts.push({
          id: `delivery-late-${order.id}`,
          type: "delivery_late",
          severity: "critical",
          orderId: order.id,
          message: `Delivery #${order.orderNumber} (${order.vipGuestName || "VIP"}) on the way for ${Math.round(age / MINUTE)} min`,
          since: order.createdAt,
          suggestedAction: "Contact driver",
        });
      }
    }
  }

  // --- Kitchen bottleneck ---
  if (kitchenCapacity > 80) {
    const preparingCount = activeOrders.filter((o) => o.status === "preparing").length;
    alerts.push({
      id: "kitchen-bottleneck",
      type: "kitchen_bottleneck",
      severity: kitchenCapacity > 90 ? "critical" : "warning",
      message: `Kitchen at ${Math.round(kitchenCapacity)}% capacity — ${preparingCount} orders cooking`,
      since: now,
      suggestedAction: "Hold new orders",
    });
  }

  // Sort: critical first, then warning, then info. Within same severity, oldest first.
  const severityOrder: Record<AlertSeverity, number> = { critical: 0, warning: 1, info: 2 };
  alerts.sort((a, b) => {
    if (severityOrder[a.severity] !== severityOrder[b.severity]) {
      return severityOrder[a.severity] - severityOrder[b.severity];
    }
    return a.since - b.since;
  });

  return alerts;
}
