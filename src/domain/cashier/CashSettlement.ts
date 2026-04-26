import type { Identifier } from "../shared/Identifier";
import { Money } from "../shared/Money";
import type { StaffId } from "../staff/Staff";
import type { SettlementStatus } from "./enums";

export type CashSettlementId = Identifier<"CashSettlement">;

/**
 * CashSettlement — a waiter handing cash to a cashier at end of shift
 * (or end of session). Lifecycle:
 *
 *   REQUESTED  — waiter declared the amount they're handing over
 *   ACCEPTED   — cashier acknowledged receipt
 *   CONFIRMED  — cashier counted it and matched the declared amount
 *   REJECTED   — cashier disputed the amount (variance was non-zero)
 *
 * The amount is stored as a positive Money; variance (when CONFIRMED)
 * lives on CashDrawer.variance, not here.
 */
export class CashSettlement {
  private constructor(
    public readonly id: CashSettlementId,
    public readonly amount: Money,
    public readonly status: SettlementStatus,
    public readonly waiterId: StaffId,
    public readonly cashierId: StaffId,
    public readonly cashierName: string | null,
    public readonly requestedAt: Date,
    public readonly acceptedAt: Date | null,
    public readonly confirmedAt: Date | null,
  ) {}

  static rehydrate(props: {
    id: CashSettlementId;
    amount: Money;
    status: SettlementStatus;
    waiterId: StaffId;
    cashierId: StaffId;
    cashierName: string | null;
    requestedAt: Date;
    acceptedAt: Date | null;
    confirmedAt: Date | null;
  }): CashSettlement {
    return new CashSettlement(
      props.id,
      props.amount,
      props.status,
      props.waiterId,
      props.cashierId,
      props.cashierName,
      props.requestedAt,
      props.acceptedAt,
      props.confirmedAt,
    );
  }

  isPending(): boolean {
    return this.status === "REQUESTED" || this.status === "ACCEPTED";
  }
}
