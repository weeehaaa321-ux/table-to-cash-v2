import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

/**
 * Verify that the request comes from an authenticated staff member
 * with OWNER or FLOOR_MANAGER role.
 *
 * Checks the `x-staff-id` header against the database.
 * Returns the staff record on success, or a 401/403 NextResponse on failure.
 */
export async function requireOwnerAuth(
  request: NextRequest
): Promise<{ id: string; role: string; restaurantId: string } | NextResponse> {
  const staffId = request.headers.get("x-staff-id");

  if (!staffId) {
    return NextResponse.json(
      { error: "Authentication required" },
      { status: 401 }
    );
  }

  const staff = await db.staff.findUnique({
    where: { id: staffId },
    select: { id: true, role: true, restaurantId: true, active: true },
  });

  if (!staff || !staff.active) {
    return NextResponse.json(
      { error: "Invalid or inactive staff account" },
      { status: 401 }
    );
  }

  if (staff.role !== "OWNER" && staff.role !== "FLOOR_MANAGER") {
    return NextResponse.json(
      { error: "Owner or floor manager access required" },
      { status: 403 }
    );
  }

  return staff;
}

/**
 * Verify that the request comes from any authenticated, active staff member.
 * Used for staff-only endpoints (order status, settlements, delivery, etc.)
 * where any role is acceptable.
 *
 * Optionally pass allowedRoles to restrict to specific roles.
 */
export async function requireStaffAuth(
  request: NextRequest,
  allowedRoles?: string[]
): Promise<{ id: string; role: string; restaurantId: string } | NextResponse> {
  const staffId = request.headers.get("x-staff-id");

  if (!staffId) {
    return NextResponse.json(
      { error: "Authentication required" },
      { status: 401 }
    );
  }

  const staff = await db.staff.findUnique({
    where: { id: staffId },
    select: { id: true, role: true, restaurantId: true, active: true },
  });

  if (!staff || !staff.active) {
    return NextResponse.json(
      { error: "Invalid or inactive staff account" },
      { status: 401 }
    );
  }

  if (allowedRoles && !allowedRoles.includes(staff.role)) {
    return NextResponse.json(
      { error: "Insufficient permissions" },
      { status: 403 }
    );
  }

  return staff;
}
