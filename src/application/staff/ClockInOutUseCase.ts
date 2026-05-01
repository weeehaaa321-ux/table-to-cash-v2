import type { StaffShiftRepository } from "../ports/StaffShiftRepository";
import type { Clock } from "../ports/Clock";
import type { StaffId } from "@/domain/staff/Staff";
import type { StaffShift } from "@/domain/staff/ShiftSchedule";

// A shift left open longer than this is treated as stale and ignored
// by reads — keeps the dashboard bulb honest and forces the gate to
// re-appear if a phantom row somehow lingers. With the auto-clockout
// cron now closing shifts at scheduled-end + 1h, this cap is a safety
// net for two cases:
//   - staff with shift=0 (cron skips them, no scheduled end)
//   - cron downtime (Vercel outage, deploy gap, etc.)
// 24h covers any owner-extended shift (e.g. a cashier swapped from
// shift 1 to shift 2 mid-day, ending up with ~17h between clock-in and
// auto-cron deadline) without locking the staff member out before the
// cron has a chance to close them.
const STALE_HOURS = 24;
const STALE_MS = STALE_HOURS * 60 * 60 * 1000;

/**
 * Clock-in / clock-out flows for staff time tracking.
 *
 *   - clockIn refuses if there's a *fresh* open shift (409 ALREADY_CLOCKED_IN);
 *     stale ones are auto-closed and a new one is opened
 *   - clockOut refuses if there's no open shift (409 NOT_CLOCKED_IN)
 *   - reads (getOpenForStaff / listOpenStaffIds) ignore shifts older
 *     than STALE_HOURS so phantom rows don't keep staff "clocked in"
 */
export class ClockInOutUseCase {
  constructor(
    private readonly shifts: StaffShiftRepository,
    private readonly clock: Clock,
  ) {}

  private staleCutoff(): Date {
    return new Date(this.clock.now().getTime() - STALE_MS);
  }

  async clockIn(staffId: StaffId): Promise<
    | { ok: true; shift: StaffShift }
    | { ok: false; reason: "ALREADY_CLOCKED_IN"; openShiftId: string }
  > {
    const cutoff = this.staleCutoff();
    const fresh = await this.shifts.findOpenForStaff(staffId, cutoff);
    if (fresh) {
      return { ok: false, reason: "ALREADY_CLOCKED_IN", openShiftId: fresh.id };
    }
    // No fresh shift — but a stale one may still exist; close it before
    // opening a new one so we don't leave duplicate open rows behind.
    const stale = await this.shifts.findOpenForStaff(staffId);
    if (stale) {
      await this.shifts.close(stale.id, this.clock.now());
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
    return this.shifts.findOpenForStaff(staffId, this.staleCutoff());
  }

  async listOpenStaffIds(): Promise<readonly string[]> {
    return this.shifts.listOpenStaffIds(this.staleCutoff());
  }

  async listInRange(from: Date, to: Date): Promise<readonly StaffShift[]> {
    return this.shifts.listInRange(from, to);
  }
}
