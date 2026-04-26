import type { PrismaRestaurantRepository } from "@/infrastructure/prisma/repositories/PrismaRestaurantRepository";

/**
 * Restaurant config updates (waiter capacity, etc.). The base
 * RestaurantRepository port doesn't include mutations because they're
 * rare admin ops; this use case takes the concrete Prisma repo to
 * access the update method directly. If more surfaces need this, lift
 * an UpdateRestaurantRepository port.
 */
export class UpdateRestaurantConfigUseCase {
  constructor(private readonly repo: PrismaRestaurantRepository) {}

  async setWaiterCapacity(capacity: number): Promise<void> {
    await this.repo.updateWaiterCapacity(capacity);
  }
}
