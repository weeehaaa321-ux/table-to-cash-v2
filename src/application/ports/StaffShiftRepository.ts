import type { StaffShift } from "@/domain/staff/ShiftSchedule";
import type { StaffId } from "@/domain/staff/Staff";

export interface StaffShiftRepository {
  /** Currently open shift for a staff member, or null if not clocked in. */
  findOpenForStaff(staffId: StaffId): Promise<StaffShift | null>;
  /** Staff IDs with an open shift right now (for the dashboard's "clocked-in" indicator). */
  listOpenStaffIds(): Promise<readonly string[]>;
  /** Open a new shift (clock in). */
  open(staffId: StaffId, openedAt: Date): Promise<StaffShift>;
  /** Close an existing open shift (clock out). Returns the closed shift. */
  close(shiftId: string, closedAt: Date): Promise<StaffShift>;
  /** Shifts that started within the given range (inclusive). For owner reports. */
  listInRange(from: Date, to: Date): Promise<readonly StaffShift[]>;
}
