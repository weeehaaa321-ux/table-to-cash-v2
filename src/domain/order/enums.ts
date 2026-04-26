// Source repo enums (prisma/schema.prisma). Mirrored exactly so the
// shape on the wire and in the DB doesn't drift. The presentation
// layer maps these to localized labels via the chrome i18n helpers.

export type OrderStatus =
  | "PENDING"
  | "CONFIRMED"
  | "PREPARING"
  | "READY"
  | "SERVED"
  | "PAID"
  | "CANCELLED";

export type PaymentMethod =
  | "CASH"
  | "CARD"
  | "INSTAPAY"
  | "APPLE_PAY"
  | "GOOGLE_PAY";

export type OrderType = "TABLE" | "VIP_DINE_IN" | "DELIVERY";

export type DeliveryStatus =
  | "ASSIGNED"
  | "PICKED_UP"
  | "ON_THE_WAY"
  | "DELIVERED";

// ─── State machine ───────────────────────────────────────────
//
// PENDING → CONFIRMED → PREPARING → READY → SERVED → PAID
//                                               ↓
//                                          (CANCELLED at any point until PAID)
//
// Used by:
//   - kitchen UI (mark CONFIRMED → PREPARING → READY)
//   - waiter UI (mark READY → SERVED)
//   - cashier UI (mark SERVED → PAID)
//   - dashboard (mark anything → CANCELLED with reason)

const VALID_TRANSITIONS: Record<OrderStatus, readonly OrderStatus[]> = {
  PENDING: ["CONFIRMED", "CANCELLED"],
  CONFIRMED: ["PREPARING", "CANCELLED"],
  PREPARING: ["READY", "CANCELLED"],
  READY: ["SERVED", "CANCELLED"],
  SERVED: ["PAID", "CANCELLED"],
  PAID: [], // terminal — no transitions out
  CANCELLED: [], // terminal
};

export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  return VALID_TRANSITIONS[from].includes(to);
}

export function isTerminal(status: OrderStatus): boolean {
  return status === "PAID" || status === "CANCELLED";
}
