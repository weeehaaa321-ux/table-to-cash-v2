import type { TableSession } from "../session/TableSession";
import type { Order } from "../order/Order";
import type { Staff } from "../staff/Staff";
import type { StaffId } from "../staff/Staff";

/**
 * FloorAlert — generated, not stored. Computed by the per-minute cron
 * (/api/cron/table-check) and by the floor manager dashboard's
 * useLiveData hook. Source: src/lib/floor-alerts.ts.
 *
 * Categories:
 *   stale_no_order      — table seated N min, no order placed
 *   stuck_in_kitchen    — order PREPARING for N min (kitchen bottleneck)
 *   waiter_imbalance    — one waiter has N tables, another has 0
 *   food_not_served     — order READY for N min, no SERVED transition
 *   kitchen_overload    — N orders in PREPARING simultaneously
 *
 * Pure rules — the data flows in, alerts flow out, no I/O.
 */

export type FloorAlertSeverity = "info" | "warning" | "critical";

export type FloorAlert = {
  id: string; // computed deterministically from kind+target so de-dupes work
  kind:
    | "stale_no_order"
    | "stuck_in_kitchen"
    | "waiter_imbalance"
    | "food_not_served"
    | "kitchen_overload";
  severity: FloorAlertSeverity;
  message: string;
  // Targets the alert points at (any may be null depending on kind):
  tableId: string | null;
  orderId: string | null;
  staffId: StaffId | null;
  // Numeric metric to render on the dashboard (e.g. minutes waited):
  metric: number | null;
  computedAt: Date;
};

// ─── Rule thresholds (mirrors source repo defaults) ──────────────

export const ALERT_THRESHOLDS = {
  staleNoOrderMin: 5,
  stuckInKitchenMin: 15,
  foodNotServedMin: 5,
  kitchenOverloadOrders: 10,
  waiterImbalanceTables: 5,
};

// ─── Rule functions ──────────────────────────────────────────────

export function staleNoOrderAlerts(
  sessions: readonly TableSession[],
  now: Date,
  thresholdMin = ALERT_THRESHOLDS.staleNoOrderMin,
): FloorAlert[] {
  return sessions
    .filter((s) => s.isStaleNoMenu(now, thresholdMin))
    .map((s) => ({
      id: `stale_no_order:${s.id}`,
      kind: "stale_no_order" as const,
      severity: "warning" as FloorAlertSeverity,
      message: `Table seated ${s.minutesSinceOpened(now)} min with no order`,
      tableId: s.tableId,
      orderId: null,
      staffId: s.waiterId,
      metric: s.minutesSinceOpened(now),
      computedAt: now,
    }));
}

export function stuckInKitchenAlerts(
  preparingOrders: readonly Order[],
  now: Date,
  thresholdMin = ALERT_THRESHOLDS.stuckInKitchenMin,
): FloorAlert[] {
  return preparingOrders
    .filter((o) => {
      const ageMin = (now.getTime() - o.createdAt.getTime()) / 60_000;
      return ageMin >= thresholdMin;
    })
    .map((o) => {
      const ageMin = Math.floor((now.getTime() - o.createdAt.getTime()) / 60_000);
      return {
        id: `stuck_in_kitchen:${o.id}`,
        kind: "stuck_in_kitchen" as const,
        severity: "critical" as FloorAlertSeverity,
        message: `Order #${o.orderNumber} in kitchen for ${ageMin} min`,
        tableId: o.tableId,
        orderId: o.id,
        staffId: null,
        metric: ageMin,
        computedAt: now,
      };
    });
}

export function waiterImbalanceAlerts(
  waitersWithSessionCounts: ReadonlyMap<Staff, number>,
  now: Date,
  thresholdDelta = ALERT_THRESHOLDS.waiterImbalanceTables,
): FloorAlert[] {
  const counts = [...waitersWithSessionCounts.values()];
  if (counts.length < 2) return [];
  const max = Math.max(...counts);
  const min = Math.min(...counts);
  if (max - min < thresholdDelta) return [];

  const alerts: FloorAlert[] = [];
  for (const [staff, count] of waitersWithSessionCounts) {
    if (count === max) {
      alerts.push({
        id: `waiter_imbalance:${staff.id}`,
        kind: "waiter_imbalance",
        severity: "warning",
        message: `${staff.displayLabel()} has ${count} tables — others have ${min}`,
        tableId: null,
        orderId: null,
        staffId: staff.id,
        metric: count,
        computedAt: now,
      });
    }
  }
  return alerts;
}
