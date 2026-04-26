import type { Identifier } from "../shared/Identifier";

export type TableId = Identifier<"Table">;

/**
 * A physical dining table. Identified by an integer `number` per restaurant
 * (unique constraint in DB: @@unique([restaurantId, number])). Optional
 * `label` is a free-text human name like "Terrace 3" or "Window".
 *
 * QR code is the URL/payload encoded into the table's printed QR sticker.
 * Scanning lands the guest at /scan?t=... which opens a session.
 */
export class Table {
  private constructor(
    public readonly id: TableId,
    public readonly number: number,
    public readonly label: string | null,
    public readonly qrCode: string | null,
  ) {}

  static rehydrate(props: {
    id: TableId;
    number: number;
    label: string | null;
    qrCode: string | null;
  }): Table {
    return new Table(props.id, props.number, props.label, props.qrCode);
  }

  /**
   * Display name preferring `label`, falling back to "Table N".
   * Source repo uses this pattern in the floor map.
   */
  displayName(): string {
    return this.label ?? `Table ${this.number}`;
  }
}
