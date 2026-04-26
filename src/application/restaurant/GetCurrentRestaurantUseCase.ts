import type { RestaurantRepository } from "../ports/RestaurantRepository";
import type { Restaurant } from "@/domain/restaurant/Restaurant";

export class GetCurrentRestaurantUseCase {
  constructor(private readonly repo: RestaurantRepository) {}

  /** Returns the current restaurant if its slug matches, or null otherwise.
      Source contract: GET /api/restaurant?slug=X returns 404 when slug
      doesn't match — preserved by returning null here. */
  async bySlug(slug: string | null): Promise<Restaurant | null> {
    const r = await this.repo.current();
    if (slug && r.slug !== slug) return null;
    return r;
  }
}
