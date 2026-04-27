import type { Restaurant } from "@/domain/restaurant/Restaurant";
import type { Table } from "@/domain/restaurant/Table";

export type DeleteTableResult =
  | { ok: true }
  | { ok: false; reason: "not_found" | "has_active_session" };

export interface RestaurantRepository {
  /**
   * The current restaurant — single-tenant per deploy, so this is
   * effectively a singleton lookup by RESTAURANT_SLUG. Implementations
   * may cache this at module scope.
   */
  current(): Promise<Restaurant>;
  listTables(): Promise<readonly Table[]>;
  findTableById(id: string): Promise<Table | null>;
  findTableByNumber(number: number): Promise<Table | null>;

  /** Append a new table at max(number)+1, with the given label or "Table N". */
  addNextTable(label: string | null): Promise<{ id: string; number: number; label: string }>;
  /** Delete a table + cascade (sessions, orders, items, ratings, joinRequests). */
  deleteTableByNumberCascade(number: number): Promise<DeleteTableResult>;
  /** Update the waiter capacity setting on the current restaurant. */
  updateWaiterCapacity(capacity: number): Promise<void>;
}
