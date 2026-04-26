import type { Identifier } from "../shared/Identifier";
import { Money } from "../shared/Money";
import type { StaffId } from "../staff/Staff";

export type CashDrawerId = Identifier<"CashDrawer">;

/**
 * CashDrawer — one cashier's drawer session. Opened with a physical
 * float (e.g. 500 EGP), closed when the cashier counts out at end of
 * shift. Variance = closingCount - expectedCash (negative = short,
 * positive = over).
 *
 * Variance is signed and CAN be negative — but it's stored as a
 * separate Decimal at the DB level, NOT a Money value object (Money
 * is unsigned by design). On the entity we keep it as a number.
 */
export class CashDrawer {
  private constructor(
    public readonly id: CashDrawerId,
    public readonly cashierId: StaffId,
    public readonly openedAt: Date,
    public readonly closedAt: Date | null,
    public readonly openingFloat: Money,
    public readonly closingCount: Money | null,
    public readonly expectedCash: Money | null,
    /** Signed: negative = short, positive = over. Null until closed. */
    public readonly varianceMinor: number | null,
    public readonly notes: string | null,
  ) {}

  static rehydrate(props: {
    id: CashDrawerId;
    cashierId: StaffId;
    openedAt: Date;
    closedAt: Date | null;
    openingFloat: Money;
    closingCount: Money | null;
    expectedCash: Money | null;
    varianceMinor: number | null;
    notes: string | null;
  }): CashDrawer {
    return new CashDrawer(
      props.id,
      props.cashierId,
      props.openedAt,
      props.closedAt,
      props.openingFloat,
      props.closingCount,
      props.expectedCash,
      props.varianceMinor,
      props.notes,
    );
  }

  isOpen(): boolean {
    return this.closedAt === null;
  }
}
