import type { StaffAuthenticator } from "../ports/StaffAuthenticator";
import { StaffPin } from "@/domain/staff/StaffPin";
import type { Staff } from "@/domain/staff/Staff";
import type { StaffRole } from "@/domain/staff/enums";
import { isPrivileged } from "@/domain/staff/enums";

/**
 * Two flows:
 *   loginByPin  — guest types PIN at /waiter, /cashier, /kitchen, etc.
 *                 We validate, return Staff record. Caller stores
 *                 staff.id in client localStorage and sends it as
 *                 `x-staff-id` on subsequent requests.
 *   authorizeRequest — middleware-style: given a staff id from the
 *                      header, return the Staff if it's still active
 *                      and (optionally) has a role in the allowed list.
 */
export class AuthenticateStaffUseCase {
  constructor(private readonly auth: StaffAuthenticator) {}

  async loginByPin(rawPin: string): Promise<
    | { ok: true; staff: Staff }
    | { ok: false; reason: "invalid_pin" | "inactive" | "wrong_pin" }
  > {
    let pin: StaffPin;
    try {
      pin = StaffPin.parse(rawPin);
    } catch {
      return { ok: false, reason: "invalid_pin" };
    }
    const staff = await this.auth.byPin(pin);
    if (!staff) return { ok: false, reason: "wrong_pin" };
    if (!staff.active) return { ok: false, reason: "inactive" };
    return { ok: true, staff };
  }

  async authorizeRequest(input: {
    staffId: string | null;
    requirePrivileged?: boolean;
    allowedRoles?: readonly StaffRole[];
  }): Promise<
    | { ok: true; staff: Staff }
    | { ok: false; reason: "no_id" | "not_found" | "inactive" | "forbidden" }
  > {
    if (!input.staffId) return { ok: false, reason: "no_id" };
    const staff = await this.auth.byId(input.staffId);
    if (!staff) return { ok: false, reason: "not_found" };
    if (!staff.active) return { ok: false, reason: "inactive" };
    if (input.requirePrivileged && !isPrivileged(staff.role)) {
      return { ok: false, reason: "forbidden" };
    }
    if (input.allowedRoles && !input.allowedRoles.includes(staff.role)) {
      return { ok: false, reason: "forbidden" };
    }
    return { ok: true, staff };
  }
}
