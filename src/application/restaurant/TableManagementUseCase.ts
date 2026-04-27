import type { RestaurantRepository, DeleteTableResult } from "@/application/ports/RestaurantRepository";
import type { Table } from "@/domain/restaurant/Table";

/**
 * Table CRUD operations. Cascade-delete logic lives behind the
 * RestaurantRepository port so this use case stays infrastructure-free.
 */
export class TableManagementUseCase {
  constructor(private readonly repo: RestaurantRepository) {}

  async list(): Promise<readonly Table[]> {
    return this.repo.listTables();
  }

  async addNext(label: string | null): Promise<{ id: string; number: number; label: string }> {
    return this.repo.addNextTable(label);
  }

  async deleteByNumber(number: number): Promise<DeleteTableResult> {
    return this.repo.deleteTableByNumberCascade(number);
  }
}
