import { Staff } from "@/domain/staff/Staff";
import { StaffShift } from "@/domain/staff/ShiftSchedule";
import type { StaffRole } from "@/domain/staff/enums";
import { makeId } from "@/domain/shared/Identifier";

export function mapStaff(row: {
  id: string;
  name: string;
  code: string | null;
  role: string;
  active: boolean;
  shift: number;
  deliveryOnline: boolean;
  createdAt: Date;
}): Staff {
  return Staff.rehydrate({
    id: makeId<"Staff">(row.id),
    name: row.name,
    code: row.code,
    role: row.role as StaffRole,
    active: row.active,
    shift: row.shift,
    deliveryOnline: row.deliveryOnline,
    createdAt: row.createdAt,
  });
}

export function mapStaffShift(row: {
  id: string;
  staffId: string;
  clockIn: Date;
  clockOut: Date | null;
  notes: string | null;
}): StaffShift {
  return StaffShift.rehydrate({
    id: makeId<"StaffShift">(row.id),
    staffId: makeId<"Staff">(row.staffId),
    clockIn: row.clockIn,
    clockOut: row.clockOut,
    notes: row.notes,
  });
}
