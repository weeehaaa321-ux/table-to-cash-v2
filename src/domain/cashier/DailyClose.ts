import type { Identifier } from "../shared/Identifier";

export type DailyCloseId = Identifier<"DailyClose">;

/**
 * DailyClose — end-of-day snapshot. Per docs/INVENTORY.md, the totals
 * are stored as a frozen JSON blob so later DB edits can't silently
 * rewrite history.
 *
 * Schema shape of `totals`:
 *   { revenue, orders, cash, card, instapay, comped, cancelled,
 *     guests, sessions, byWaiter: [...] }
 *
 * Domain treats `totals` as opaque (Record<string, unknown>) — the
 * presentation layer renders it; the application layer assembles it
 * from the day's queries before persisting.
 */
export class DailyClose {
  private constructor(
    public readonly id: DailyCloseId,
    public readonly date: Date, // @db.Date
    public readonly closedAt: Date,
    public readonly closedById: string | null,
    public readonly closedByName: string | null,
    public readonly totals: Record<string, unknown>,
    public readonly notes: string | null,
  ) {}

  static rehydrate(props: {
    id: DailyCloseId;
    date: Date;
    closedAt: Date;
    closedById: string | null;
    closedByName: string | null;
    totals: Record<string, unknown>;
    notes: string | null;
  }): DailyClose {
    return new DailyClose(
      props.id,
      props.date,
      props.closedAt,
      props.closedById,
      props.closedByName,
      props.totals,
      props.notes,
    );
  }
}
