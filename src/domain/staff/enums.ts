// Roles a staff member can hold. Source: schema.prisma StaffRole enum.
//
// Permission semantics (from src/lib/api-auth.ts):
//   OWNER          — full admin
//   FLOOR_MANAGER  — same as OWNER for the api-auth helpers
//   WAITER         — sees own tables, takes orders, hands off to cashier
//   RUNNER         — runner-queue model: shared /runner queue, no
//                    table assignment. WAITER staff also route to
//                    /runner when Restaurant.serviceModel=RUNNER.
//   KITCHEN        — KDS for food (Station=KITCHEN)
//   BAR            — KDS for drinks (Station=BAR)
//   CASHIER        — settlements, drawer, daily close
//   DELIVERY       — assigned delivery orders, online/offline toggle

export type StaffRole =
  | "OWNER"
  | "FLOOR_MANAGER"
  | "WAITER"
  | "RUNNER"
  | "KITCHEN"
  | "BAR"
  | "CASHIER"
  | "DELIVERY";

const PRIVILEGED_ROLES: readonly StaffRole[] = ["OWNER", "FLOOR_MANAGER"];

export function isPrivileged(role: StaffRole): boolean {
  return PRIVILEGED_ROLES.includes(role);
}
