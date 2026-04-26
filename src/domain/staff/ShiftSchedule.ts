import type { Identifier } from "../shared/Identifier";
import type { StaffId } from "./Staff";

export type ShiftScheduleId = Identifier<"ShiftSchedule">;

/**
 * ShiftSchedule — planned roster: "staff X is assigned to shift Y on
 * date D". One row per staff per date (unique constraint). Distinct
 * from StaffShift (= what actually happened, with clockIn/clockOut).
 *
 * `shift` matches Staff.shift values:
 *   0 = unassigned
 *   1 = 00:00–08:00 (Cairo time)
 *   2 = 08:00–16:00
 *   3 = 16:00–00:00
 */
export class ShiftSchedule {
  private constructor(
    public readonly id: ShiftScheduleId,
    public readonly staffId: StaffId,
    public readonly date: Date, // @db.Date — midnight UTC of the calendar day
    public readonly shift: number,
    public readonly createdAt: Date,
  ) {}

  static rehydrate(props: {
    id: ShiftScheduleId;
    staffId: StaffId;
    date: Date;
    shift: number;
    createdAt: Date;
  }): ShiftSchedule {
    return new ShiftSchedule(
      props.id,
      props.staffId,
      props.date,
      props.shift,
      props.createdAt,
    );
  }
}

/**
 * StaffShift — actual time worked (clock in / clock out). Open shift
 * has clockOut === null. One staff member can have many shifts over
 * time but only one open at a time (enforced by the application use
 * case, not the DB).
 */
export class StaffShift {
  private constructor(
    public readonly id: Identifier<"StaffShift">,
    public readonly staffId: StaffId,
    public readonly clockIn: Date,
    public readonly clockOut: Date | null,
    public readonly notes: string | null,
  ) {}

  static rehydrate(props: {
    id: Identifier<"StaffShift">;
    staffId: StaffId;
    clockIn: Date;
    clockOut: Date | null;
    notes: string | null;
  }): StaffShift {
    return new StaffShift(
      props.id,
      props.staffId,
      props.clockIn,
      props.clockOut,
      props.notes,
    );
  }

  isOpen(): boolean {
    return this.clockOut === null;
  }

  durationMinutes(now: Date): number {
    const end = this.clockOut ?? now;
    return Math.floor((end.getTime() - this.clockIn.getTime()) / 60_000);
  }
}
