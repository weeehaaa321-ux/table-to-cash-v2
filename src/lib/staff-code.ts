import type { StaffRole } from "@/generated/prisma/client";

// Per-role prefix for staff codes. Short so it fits on a staff card badge.
// OWNER is intentionally not listed — owners don't get codes.
const ROLE_PREFIX: Record<Exclude<StaffRole, "OWNER">, string> = {
  WAITER: "WAI",
  CASHIER: "CSH",
  KITCHEN: "KIT",
  BAR: "BAR",
  FLOOR_MANAGER: "FLR",
  DELIVERY: "DEL",
};

// Generate a candidate code like "WAI-482". Caller must check uniqueness
// within the target restaurant and retry on collision.
export function generateStaffCode(role: StaffRole): string {
  if (role === "OWNER") {
    throw new Error("Owners do not get staff codes");
  }
  const prefix = ROLE_PREFIX[role as Exclude<StaffRole, "OWNER">];
  const suffix = String(Math.floor(100 + Math.random() * 900));
  return `${prefix}-${suffix}`;
}

// Allocate a unique code for a given restaurant by retrying until the
// candidate doesn't collide. Returns the allocated code. The caller is
// responsible for the INSERT/UPDATE; we only need a Prisma-like client
// with `staff.findFirst` to do the collision check.
export async function allocateStaffCode(
  role: StaffRole,
  restaurantId: string,
  findFirst: (code: string) => Promise<{ id: string } | null>
): Promise<string> {
  if (role === "OWNER") {
    throw new Error("Owners do not get staff codes");
  }
  for (let i = 0; i < 25; i++) {
    const candidate = generateStaffCode(role);
    const clash = await findFirst(candidate);
    if (!clash) return candidate;
  }
  throw new Error(`Could not allocate unique staff code for restaurant ${restaurantId}`);
}
