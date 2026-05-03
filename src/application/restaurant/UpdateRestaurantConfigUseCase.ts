import type { RestaurantRepository } from "@/application/ports/RestaurantRepository";

/**
 * Restaurant config updates (waiter capacity, etc.). Talks only to the
 * RestaurantRepository port — concrete adapter is wired in composition.
 */
export class UpdateRestaurantConfigUseCase {
  constructor(private readonly repo: RestaurantRepository) {}

  async setWaiterCapacity(capacity: number): Promise<void> {
    await this.repo.updateWaiterCapacity(capacity);
  }

  async setInstapay(input: { handle?: string | null; phone?: string | null }): Promise<void> {
    await this.repo.updateInstapay(input);
  }
}
