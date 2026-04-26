import type { Staff } from "@/domain/staff/Staff";
import type { StaffPin } from "@/domain/staff/StaffPin";

/**
 * Auth port. Per docs/INVENTORY.md §14 Q3: header-based `x-staff-id`
 * lookup, no JWT, no cookies. Two operations:
 *
 *   byId  — used by the API middleware on every authenticated request
 *           to resolve the staff identity from `x-staff-id` header.
 *   byPin — used by /api/staff/login to validate a typed PIN against
 *           the bcrypt-hashed `Staff.pin` column.
 *
 * Both return null on failure (not found / inactive / wrong PIN).
 * The application layer decides what HTTP code to return.
 */
export interface StaffAuthenticator {
  byId(staffId: string): Promise<Staff | null>;
  byPin(pin: StaffPin): Promise<Staff | null>;
}
