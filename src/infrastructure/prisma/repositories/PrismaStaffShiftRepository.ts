import { db } from "../client";
import { env } from "../../config/env";
import type { StaffShiftRepository } from "@/application/ports/StaffShiftRepository";
import type { StaffShift } from "@/domain/staff/ShiftSchedule";
import type { StaffId } from "@/domain/staff/Staff";
import { mapStaffShift } from "../mappers/staffMappers";

let cachedRestaurantId: string | null = null;

async function getRestaurantId(): Promise<string> {
  if (cachedRestaurantId) return cachedRestaurantId;
  const r = await db.restaurant.findUnique({
    where: { slug: env.RESTAURANT_SLUG },
    select: { id: true },
  });
  if (!r) throw new Error(`No Restaurant with slug=${env.RESTAURANT_SLUG}`);
  cachedRestaurantId = r.id;
  return r.id;
}

export class PrismaStaffShiftRepository implements StaffShiftRepository {
  async findOpenForStaff(staffId: StaffId): Promise<StaffShift | null> {
    const row = await db.staffShift.findFirst({
      where: { staffId, clockOut: null },
      orderBy: { clockIn: "desc" },
    });
    return row ? mapStaffShift(row) : null;
  }

  async listOpenStaffIds(): Promise<readonly string[]> {
    const restaurantId = await getRestaurantId();
    const rows = await db.staffShift.findMany({
      where: { restaurantId, clockOut: null },
      select: { staffId: true },
    });
    return rows.map((r) => r.staffId);
  }

  async open(staffId: StaffId, _openedAt: Date): Promise<StaffShift> {
    const restaurantId = await getRestaurantId();
    const row = await db.staffShift.create({
      data: { staffId, restaurantId },
    });
    return mapStaffShift(row);
  }

  async close(shiftId: string, closedAt: Date): Promise<StaffShift> {
    const row = await db.staffShift.update({
      where: { id: shiftId },
      data: { clockOut: closedAt },
    });
    return mapStaffShift(row);
  }

  async listInRange(from: Date, to: Date): Promise<readonly StaffShift[]> {
    const restaurantId = await getRestaurantId();
    const rows = await db.staffShift.findMany({
      where: {
        restaurantId,
        clockIn: { gte: from, lte: to },
      },
      orderBy: { clockIn: "desc" },
    });
    return rows.map(mapStaffShift);
  }
}
