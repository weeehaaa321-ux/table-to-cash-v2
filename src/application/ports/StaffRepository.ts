import type { Staff } from "@/domain/staff/Staff";
import type { StaffRole } from "@/domain/staff/enums";

export interface StaffRepository {
  findById(id: string): Promise<Staff | null>;
  /** Active staff with the given role. */
  listActiveByRole(role: StaffRole): Promise<readonly Staff[]>;
  /** Active staff in any role. */
  listAllActive(): Promise<readonly Staff[]>;
  /** Drivers currently online. */
  listOnlineDrivers(): Promise<readonly Staff[]>;
}
