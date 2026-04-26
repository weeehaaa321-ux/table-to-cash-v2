import type { Identifier } from "../shared/Identifier";
import type { TableId } from "../restaurant/Table";
import type { OrderType } from "../order/enums";
import type { SessionStatus } from "./enums";

export type SessionId = Identifier<"TableSession">;
export type StaffId = Identifier<"Staff">;
export type VipGuestId = Identifier<"VipGuest">;

/**
 * TableSession — a guest's seated period at a table (or a VIP delivery
 * session). Holds:
 *   - which table (null for delivery / unassigned VIP)
 *   - which waiter is responsible
 *   - guest count, room number (for hotel-attached cafes), guest type
 *   - openedAt / menuOpenedAt / closedAt (used for floor alerts:
 *     "table seated 5 min with no menu open")
 *
 * Multi-round billing: a single session may have many Order rows,
 * representing rounds. The session aggregate doesn't store rounds —
 * it composes them at read time from its `orders` collection. See
 * domain/session/SessionRound.ts for the read model.
 */
export class TableSession {
  private constructor(
    public readonly id: SessionId,
    public readonly tableId: TableId | null,
    public readonly status: SessionStatus,
    public readonly guestType: string,
    public readonly roomNumber: string | null,
    public readonly guestCount: number,
    public readonly waiterId: StaffId | null,
    public readonly orderType: OrderType,
    public readonly vipGuestId: VipGuestId | null,
    public readonly openedAt: Date,
    public readonly menuOpenedAt: Date | null,
    public readonly closedAt: Date | null,
  ) {}

  static rehydrate(props: {
    id: SessionId;
    tableId: TableId | null;
    status: SessionStatus;
    guestType: string;
    roomNumber: string | null;
    guestCount: number;
    waiterId: StaffId | null;
    orderType: OrderType;
    vipGuestId: VipGuestId | null;
    openedAt: Date;
    menuOpenedAt: Date | null;
    closedAt: Date | null;
  }): TableSession {
    return new TableSession(
      props.id,
      props.tableId,
      props.status,
      props.guestType,
      props.roomNumber,
      props.guestCount,
      props.waiterId,
      props.orderType,
      props.vipGuestId,
      props.openedAt,
      props.menuOpenedAt,
      props.closedAt,
    );
  }

  isOpen(): boolean {
    return this.status === "OPEN";
  }

  /**
   * Minutes since the session opened. Used by floor alerts:
   * "table seated 5 min with no order".
   */
  minutesSinceOpened(now: Date): number {
    return Math.floor((now.getTime() - this.openedAt.getTime()) / 60_000);
  }

  /**
   * True when the session opened more than `thresholdMinutes` ago and
   * the menu has never been opened. This is the "guest abandoned at
   * the table" alert condition.
   */
  isStaleNoMenu(now: Date, thresholdMinutes: number): boolean {
    if (!this.isOpen()) return false;
    if (this.menuOpenedAt !== null) return false;
    return this.minutesSinceOpened(now) >= thresholdMinutes;
  }
}
