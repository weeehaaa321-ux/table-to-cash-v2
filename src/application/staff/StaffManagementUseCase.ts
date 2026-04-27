// Staff CRUD + login + owner ops + performance reports.
// Wraps legacy lib/{api-auth,shifts,staff-code,staff-fetch,waiter-transfer}.

import { db } from "@/lib/db";
import { canLoginNow, getShiftCount } from "@/lib/shifts";
import { allocateStaffCode } from "@/lib/staff-code";
import { transferWaiterSessions } from "@/lib/waiter-transfer";
import { nowInRestaurantTz } from "@/lib/restaurant-config";
import bcrypt from "bcryptjs";

export class StaffManagementUseCase {
  async resolveRestaurantId(id: string): Promise<string | null> {
    if (!id) return null;
    if (id.startsWith("c") && id.length > 10) return id;
    const r = await db.restaurant.findUnique({ where: { slug: id }, select: { id: true } });
    return r?.id || null;
  }

  /**
   * PIN login. Mirrors the source flow: bcrypt-compare against active
   * staff, sync shift from today's schedule, enforce shift-based login
   * windows for non-OWNER roles.
   */
  async login(pin: string, restaurantId: string): Promise<
    | { ok: true; staff: { id: string; name: string; role: string; shift: number } }
    | { ok: false; status: number; reason: string }
  > {
    const allStaff = await db.staff.findMany({
      where: { restaurantId, active: true },
      select: { id: true, name: true, role: true, shift: true, pin: true },
    });

    let matched: { id: string; name: string; role: string; shift: number } | null = null;
    for (const s of allStaff) {
      const isHashed = s.pin.startsWith("$2a$") || s.pin.startsWith("$2b$");
      let match = false;
      if (isHashed) match = await bcrypt.compare(pin, s.pin);
      else {
        match = pin === s.pin;
        if (match) {
          const hashed = await bcrypt.hash(pin, 10);
          await db.staff.update({ where: { id: s.id }, data: { pin: hashed } }).catch(() => {});
        }
      }
      if (match) {
        matched = { id: s.id, name: s.name, role: s.role, shift: s.shift };
        break;
      }
    }

    if (!matched) return { ok: false, status: 401, reason: "Invalid PIN" };

    let effectiveShift = matched.shift;
    if (matched.role !== "OWNER") {
      const now = nowInRestaurantTz();
      const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
      const todayStart = new Date(todayStr + "T00:00:00Z");
      const tomorrow = new Date(todayStart);
      tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
      const schedule = await db.shiftSchedule.findFirst({
        where: { staffId: matched.id, date: { gte: todayStart, lt: tomorrow } },
        select: { shift: true },
      });
      if (schedule && schedule.shift !== matched.shift) {
        await db.staff.update({ where: { id: matched.id }, data: { shift: schedule.shift } });
        effectiveShift = schedule.shift;
      }
    }

    if (matched.role !== "OWNER" && effectiveShift !== 0) {
      const check = canLoginNow(effectiveShift, matched.role);
      if (!check.allowed) return { ok: false, status: 403, reason: check.reason };
    }

    return { ok: true, staff: { ...matched, shift: effectiveShift } };
  }

  async findById(id: string) {
    return db.staff.findUnique({ where: { id }, select: { id: true } });
  }

  async findOwnerPublic(id: string) {
    return db.staff.findUnique({
      where: { id },
      select: { id: true, name: true, role: true },
    });
  }

  async findOwnerForUpdate(id: string) {
    return db.staff.findUnique({
      where: { id },
      select: { id: true, pin: true, role: true, restaurantId: true },
    });
  }

  async verifyPin(plain: string, stored: string): Promise<boolean> {
    const isHashed = stored.startsWith("$2a$") || stored.startsWith("$2b$");
    return isHashed ? bcrypt.compare(plain, stored) : plain === stored;
  }

  async updateProfileSelectPublic(id: string, data: Record<string, unknown>) {
    if (typeof data.pin === "string") {
      data = { ...data, pin: await bcrypt.hash(data.pin, 10) };
    }
    return db.staff.update({
      where: { id },
      data,
      select: { id: true, name: true },
    });
  }

  async findActorIdentity(id: string) {
    return db.staff.findUnique({
      where: { id },
      select: { id: true, name: true, restaurantId: true },
    });
  }

  async listByIds(ids: string[]) {
    return db.staff.findMany({
      where: { id: { in: ids } },
      select: { id: true, name: true, role: true },
    });
  }

  async listWaitersBasic(restaurantId: string) {
    return db.staff.findMany({
      where: { restaurantId, role: "WAITER" },
      select: { id: true, name: true, active: true, shift: true },
      orderBy: { name: "asc" },
    });
  }

  async listSessionsForPerformance(restaurantId: string, since: Date) {
    return db.tableSession.findMany({
      where: {
        restaurantId,
        waiterId: { not: null },
        openedAt: { gte: since },
      },
      include: {
        orders: {
          select: {
            id: true,
            total: true,
            status: true,
            paymentMethod: true,
            items: { select: { quantity: true } },
            createdAt: true,
            updatedAt: true,
            paidAt: true,
          },
        },
        waiter: { select: { id: true } },
      },
    });
  }

  async findRoleById(id: string) {
    return db.staff.findUnique({ where: { id }, select: { role: true } });
  }

  async deactivateOnEndShift(staffId: string, opts: { setDeliveryOffline: boolean }) {
    return db.staff.update({
      where: { id: staffId },
      data: {
        active: false,
        ...(opts.setDeliveryOffline ? { deliveryOnline: false } : {}),
      },
    });
  }

  async closeOpenStaffShifts(staffId: string) {
    return db.staffShift.updateMany({
      where: { staffId, clockOut: null },
      data: { clockOut: new Date() },
    });
  }

  async listOpenSettlementsForCashier(cashierId: string, restaurantId: string) {
    return db.cashSettlement.findMany({
      where: {
        cashierId,
        restaurantId,
        status: { in: ["REQUESTED", "ACCEPTED"] },
      },
      select: { id: true },
    });
  }

  async listOtherActiveCashiers(restaurantId: string, excludeStaffId: string) {
    return db.staff.findMany({
      where: { restaurantId, role: "CASHIER", active: true, id: { not: excludeStaffId } },
      orderBy: { createdAt: "asc" },
      select: { id: true, name: true },
    });
  }

  async openSettlementCountsByCashier(restaurantId: string, cashierIds: string[]) {
    return db.cashSettlement.groupBy({
      by: ["cashierId"],
      where: {
        restaurantId,
        cashierId: { in: cashierIds },
        status: { in: ["REQUESTED", "ACCEPTED"] },
      },
      _count: true,
    });
  }

  async reassignSettlements(settlementIds: string[], to: { id: string; name: string }) {
    return db.cashSettlement.updateMany({
      where: { id: { in: settlementIds } },
      data: { cashierId: to.id, cashierName: to.name },
    });
  }

  async findCurrentForUpdate(id: string) {
    return db.staff.findUnique({
      where: { id },
      select: { role: true, active: true, restaurantId: true },
    });
  }

  /** PIN uniqueness check used by create + edit. Returns true if pin already in use. */
  async pinIsTaken(restaurantId: string, plainPin: string, exceptId?: string): Promise<boolean> {
    const where = exceptId
      ? { restaurantId, id: { not: exceptId } }
      : { restaurantId };
    const others = await db.staff.findMany({ where, select: { pin: true } });
    for (const s of others) {
      const isHashed = s.pin.startsWith("$2a$") || s.pin.startsWith("$2b$");
      const dup = isHashed ? await bcrypt.compare(plainPin, s.pin) : plainPin === s.pin;
      if (dup) return true;
    }
    return false;
  }

  async deleteWithCleanup(id: string) {
    return db.$transaction([
      db.pushSubscription.deleteMany({ where: { staffId: id } }),
      db.cashSettlement.deleteMany({
        where: { OR: [{ waiterId: id }, { cashierId: id }] },
      }),
      db.order.updateMany({
        where: { deliveryDriverId: id },
        data: { deliveryDriverId: null },
      }),
      db.tableSession.updateMany({
        where: { waiterId: id },
        data: { waiterId: null },
      }),
      db.staff.delete({ where: { id } }),
    ]);
  }

  async list(restaurantId: string) {
    return db.staff.findMany({
      where: { restaurantId, role: { not: "OWNER" } },
      orderBy: { createdAt: "desc" },
      select: {
        id: true, name: true, code: true, role: true, active: true,
        shift: true, deliveryOnline: true, restaurantId: true, createdAt: true,
      },
    });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async create(input: { name: string; pin: string; role: any; restaurantId: string; shift?: number }) {
    const hashed = await bcrypt.hash(input.pin, 10);
    const code = await allocateStaffCode(input.role, input.restaurantId, (c) =>
      db.staff.findFirst({
        where: { restaurantId: input.restaurantId, code: c },
        select: { id: true },
      }),
    );
    return db.staff.create({
      data: {
        name: input.name,
        pin: hashed,
        role: input.role,
        code,
        restaurantId: input.restaurantId,
        shift: input.shift ?? 0,
      },
    });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async update(id: string, data: any) {
    if (data.pin) data.pin = await bcrypt.hash(data.pin, 10);
    return db.staff.update({ where: { id }, data });
  }

  async deactivate(id: string) {
    return db.staff.update({ where: { id }, data: { active: false } });
  }

  async endShift(staffId: string, transferToStaffId?: string) {
    if (transferToStaffId) {
      await transferWaiterSessions(staffId, transferToStaffId);
    }
    return db.staff.update({ where: { id: staffId }, data: { shift: 0 } });
  }

  async ownerLookup(restaurantId: string) {
    return db.staff.findFirst({ where: { restaurantId, role: "OWNER" } });
  }

  async performance(restaurantId: string) {
    const staff = await db.staff.findMany({
      where: { restaurantId, role: { in: ["WAITER", "CASHIER", "DELIVERY"] }, active: true },
      select: { id: true, name: true, role: true, code: true },
    });
    return { staff, shiftCount: getShiftCount() };
  }
}
