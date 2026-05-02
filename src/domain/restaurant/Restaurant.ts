import type { Identifier } from "../shared/Identifier";

export type RestaurantId = Identifier<"Restaurant">;

/**
 * Restaurant — the top-level tenant entity.
 *
 * Per docs/INVENTORY.md §14 Q4: at runtime the system is single-tenant
 * per Vercel deploy (RESTAURANT_SLUG, RESTAURANT_NAME, etc. are
 * NEXT_PUBLIC_* env vars baked in at build time). The schema-level
 * `restaurantId` columns exist for future multi-tenant migration but
 * the running process always operates on one Restaurant row.
 *
 * That means: this entity is rarely loaded as one of many — it's
 * loaded once per request from the slug, or read from cache. The
 * domain code stays multi-tenant-safe (entity has an id, repository
 * scopes by it), but presentation/application don't pass tenant
 * context around.
 */
export class Restaurant {
  private constructor(
    public readonly id: RestaurantId,
    public readonly name: string,
    public readonly slug: string,
    public readonly logo: string | null,
    public readonly currency: string,
    public readonly timezone: string,
    public readonly waiterCapacity: number,
    public readonly kitchenConfig: Record<string, unknown> | null,
    public readonly instapayHandle: string | null,
    public readonly instapayPhone: string | null,
    public readonly createdAt: Date,
  ) {}

  static rehydrate(props: {
    id: RestaurantId;
    name: string;
    slug: string;
    logo: string | null;
    currency: string;
    timezone: string;
    waiterCapacity: number;
    kitchenConfig: Record<string, unknown> | null;
    instapayHandle: string | null;
    instapayPhone: string | null;
    createdAt: Date;
  }): Restaurant {
    return new Restaurant(
      props.id,
      props.name,
      props.slug,
      props.logo,
      props.currency,
      props.timezone,
      props.waiterCapacity,
      props.kitchenConfig,
      props.instapayHandle,
      props.instapayPhone,
      props.createdAt,
    );
  }
}
