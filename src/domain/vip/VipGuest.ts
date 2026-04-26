import type { Identifier } from "../shared/Identifier";

export type VipGuestId = Identifier<"VipGuest">;

/**
 * VipGuest — a customer with a personal-link delivery flow. Identified
 * by `linkToken` (cuid in the URL: /vip/{linkToken}). Has cached
 * delivery address + GPS pin (lat/lng) so re-orders skip the address
 * step.
 *
 * Unique per restaurant by phone number (so the same person on a
 * different deploy gets their own VipGuest row).
 *
 * `active=false` disables the personal link without deleting history.
 */
export class VipGuest {
  private constructor(
    public readonly id: VipGuestId,
    public readonly name: string,
    public readonly phone: string,
    public readonly address: string | null,
    public readonly addressNotes: string | null,
    public readonly locationLat: number | null,
    public readonly locationLng: number | null,
    public readonly linkToken: string,
    public readonly active: boolean,
    public readonly createdAt: Date,
  ) {}

  static rehydrate(props: {
    id: VipGuestId;
    name: string;
    phone: string;
    address: string | null;
    addressNotes: string | null;
    locationLat: number | null;
    locationLng: number | null;
    linkToken: string;
    active: boolean;
    createdAt: Date;
  }): VipGuest {
    return new VipGuest(
      props.id,
      props.name,
      props.phone,
      props.address,
      props.addressNotes,
      props.locationLat,
      props.locationLng,
      props.linkToken,
      props.active,
      props.createdAt,
    );
  }

  hasPin(): boolean {
    return this.locationLat !== null && this.locationLng !== null;
  }
}
