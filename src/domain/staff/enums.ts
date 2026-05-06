// Roles a staff member can hold. Source: schema.prisma StaffRole enum.
//
// Permission semantics (from src/lib/api-auth.ts):
//   OWNER          — full admin
//   FLOOR_MANAGER  — same as OWNER for the api-auth helpers
//   WAITER         — sees own tables, takes orders, hands off to cashier
//   KITCHEN        — KDS for food (Station=KITCHEN)
//   BAR            — KDS for drinks (Station=BAR)
//   CASHIER        — settlements, drawer, daily close
//   DELIVERY       — assigned delivery orders, online/offline toggle
//
// RUNNER stays in the schema enum (Postgres can't drop enum values
// cleanly) but is not used by any code path. The previous
// runner-queue feature was reverted in favour of a per-restaurant
// `Restaurant.waiterAppEnabled` flag that simply turns the waiter
// app off when the floor doesn't need it.

export type StaffRole =
  | "OWNER"
  | "FLOOR_MANAGER"
  | "WAITER"
  | "KITCHEN"
  | "BAR"
  | "CASHIER"
  | "DELIVERY"
  | "RUNNER";

const PRIVILEGED_ROLES: readonly StaffRole[] = ["OWNER", "FLOOR_MANAGER"];

export function isPrivileged(role: StaffRole): boolean {
  return PRIVILEGED_ROLES.includes(role);
}
