import type { Identifier } from "../shared/Identifier";
import type { StaffRole } from "./enums";

export type StaffId = Identifier<"Staff">;

/**
 * Staff — a person with system access. Carries:
 *   - role
 *   - active flag (deactivated staff can't log in)
 *   - shift assignment (0=unassigned, 1=midnight–8, 2=8–16, 3=16–midnight)
 *   - deliveryOnline (only meaningful for role=DELIVERY)
 *   - code (short per-restaurant disambiguator like "WAI-482"; null for OWNER)
 *
 * The bcrypt-hashed PIN lives in the DB column but is not exposed on
 * the entity — it's used only by the infrastructure auth adapter
 * (PinAuthenticator). Domain code that needs to "check the PIN" goes
 * through the StaffAuthenticator port.
 */
export class Staff {
  private constructor(
    public readonly id: StaffId,
    public readonly name: string,
    public readonly code: string | null,
    public readonly role: StaffRole,
    public readonly active: boolean,
    public readonly shift: number,
    public readonly deliveryOnline: boolean,
    public readonly createdAt: Date,
  ) {}

  static rehydrate(props: {
    id: StaffId;
    name: string;
    code: string | null;
    role: StaffRole;
    active: boolean;
    shift: number;
    deliveryOnline: boolean;
    createdAt: Date;
  }): Staff {
    return new Staff(
      props.id,
      props.name,
      props.code,
      props.role,
      props.active,
      props.shift,
      props.deliveryOnline,
      props.createdAt,
    );
  }

  isAvailableForDelivery(): boolean {
    return this.active && this.role === "DELIVERY" && this.deliveryOnline;
  }

  displayLabel(): string {
    return this.code ? `${this.name} (${this.code})` : this.name;
  }
}
