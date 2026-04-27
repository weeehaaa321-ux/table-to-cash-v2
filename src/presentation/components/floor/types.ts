// Shared types for the Floor Manager feature set. Co-located with the
// components that consume them — not in src/lib because nothing outside
// the floor view references these shapes.

import type { TableState, LiveOrder } from "@/lib/engine/perception";

export type { TableState, LiveOrder };

export type LoggedInStaff = {
  id: string;
  name: string;
  role: string;
  shift: number;
  loginAt?: number;
};

export type SessionInfo = {
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
  isCurrentShift?: boolean;
  orderType?: string;
  vipGuestName?: string | null;
};

export type StaffInfo = {
  id: string;
  name: string;
  role: string;
  shift: number;
  active: boolean;
};

export type DeliveryOrder = {
  id: string;
  orderNumber: number;
  status: string;
  total: number;
  deliveryAddress: string | null;
  deliveryNotes: string | null;
  deliveryStatus: string | null;
  deliveryDriverId: string | null;
  deliveryDriverName: string | null;
  vipGuestName: string | null;
  vipGuestPhone: string | null;
  items: { name: string; quantity: number; price: number }[];
  createdAt: string;
  readyAt: string | null;
  pickedUpAt: string | null;
  deliveredAt: string | null;
};

export type RecentMessage = {
  id: string;
  type: string;
  from: string;
  fromName?: string;
  to: string;
  toName?: string;
  text?: string;
  command?: string;
  createdAt: number;
};

// Client-side only; session-scoped ring buffer of the floor manager's
// actions. Not persisted — server-side audit exists in Message/Session.
export type ActionLogEntry = {
  id: string;
  kind:
    | "reassign"
    | "send_waiter"
    | "prioritize"
    | "end_session"
    | "cancel_item"
    | "comp_item"
    | "change_table"
    | "add_guest"
    | "assign_driver"
    | "update_delivery"
    | "broadcast"
    | "issue"
    | "advance_status";
  label: string;
  target?: string;
  timestamp: number;
};

// Per-waiter load band — drives color, badge, ordering in Staff panels.
export type WaiterLoad = "idle" | "busy" | "heavy" | "overloaded";

export type WaiterMetric = {
  id: string;
  name: string;
  shift: number;
  onShift: boolean;
  isClockedIn: boolean;
  tables: number;
  activeOrders: number;
  openRevenue: number;
  load: WaiterLoad;
  lastActivityMins: number | null;
};

export type StaffPresence = {
  id: string;
  name: string;
  role: string;
  shift: number;
  onShift: boolean;
  isClockedIn: boolean;
};
