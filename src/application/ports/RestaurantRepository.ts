import type { Restaurant } from "@/domain/restaurant/Restaurant";
import type { Table } from "@/domain/restaurant/Table";

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
}
