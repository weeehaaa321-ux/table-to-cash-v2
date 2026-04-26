import type { StaffShiftRepository } from "../ports/StaffShiftRepository";
import type { Clock } from "../ports/Clock";
import type { StaffId } from "@/domain/staff/Staff";
import type { StaffShift } from "@/domain/staff/ShiftSchedule";

/**
 * Clock-in / clock-out flows for staff time tracking.
 *
 * Source: src/app/api/clock/route.ts. Same invariants:
 *   - clockIn refuses if there's already an open shift (409 ALREADY_CLOCKED_IN)
 *   - clockOut refuses if there's no open shift (409 NOT_CLOCKED_IN)
 */
export class ClockInOutUseCase {
  constructor(
    private readonly shifts: StaffShiftRepository,
    private readonly clock: Clock,
  ) {}

  async clockIn(staffId: StaffId): Promise<
    | { ok: true; shift: StaffShift }
    | { ok: false; reason: "ALREADY_CLOCKED_IN"; openShiftId: string }
  > {
    const existing = await this.shifts.findOpenForStaff(staffId);
    if (existing) {
      return { ok: false, reason: "ALREADY_CLOCKED_IN", openShiftId: existing.id };
    }
    const shift = await this.shifts.open(staffId, this.clock.now());
    return { ok: true, shift };
  }

  async clockOut(staffId: StaffId): Promise<
    | { ok: true; shift: StaffShift; durationMinutes: number }
    | { ok: false; reason: "NOT_CLOCKED_IN" }
  > {
    const open = await this.shifts.findOpenForStaff(staffId);
    if (!open) return { ok: false, reason: "NOT_CLOCKED_IN" };
    const closedAt = this.clock.now();
    const closed = await this.shifts.close(open.id, closedAt);
    return { ok: true, shift: closed, durationMinutes: closed.durationMinutes(closedAt) };
  }

  async getOpenForStaff(staffId: StaffId): Promise<StaffShift | null> {
    return this.shifts.findOpenForStaff(staffId);
  }

  async listOpenStaffIds(): Promise<readonly string[]> {
    return this.shifts.listOpenStaffIds();
  }

  async listInRange(from: Date, to: Date): Promise<readonly StaffShift[]> {
    return this.shifts.listInRange(from, to);
  }
}
