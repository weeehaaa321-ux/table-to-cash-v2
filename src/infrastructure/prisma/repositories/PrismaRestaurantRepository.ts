import { db } from "../client";
import { env } from "../../config/env";
import type { RestaurantRepository } from "@/application/ports/RestaurantRepository";
import { Restaurant } from "@/domain/restaurant/Restaurant";
import { Table } from "@/domain/restaurant/Table";
import type { TableId } from "@/domain/restaurant/Table";
import type { RestaurantId } from "@/domain/restaurant/Restaurant";
import { makeId } from "@/domain/shared/Identifier";

let cached: Restaurant | null = null;

export class PrismaRestaurantRepository implements RestaurantRepository {
  async current(): Promise<Restaurant> {
    if (cached) return cached;
    const row = await db.restaurant.findUnique({
      where: { slug: env.RESTAURANT_SLUG },
    });
    if (!row) throw new Error(`No Restaurant with slug=${env.RESTAURANT_SLUG}`);
    cached = Restaurant.rehydrate({
      id: makeId<"Restaurant">(row.id),
      name: row.name,
      slug: row.slug,
      logo: row.logo,
      currency: row.currency,
      timezone: row.timezone,
      waiterCapacity: row.waiterCapacity,
      kitchenConfig: (row.kitchenConfig as Record<string, unknown> | null) ?? null,
      createdAt: row.createdAt,
    });
    return cached;
  }

  async listTables(): Promise<readonly Table[]> {
    const r = await this.current();
    const rows = await db.table.findMany({
      where: { restaurantId: r.id },
      orderBy: { number: "asc" },
    });
    return rows.map((t) => Table.rehydrate({
      id: makeId<"Table">(t.id),
      number: t.number,
      label: t.label,
      qrCode: t.qrCode,
    }));
  }

  async findTableById(id: string): Promise<Table | null> {
    const t = await db.table.findUnique({ where: { id } });
    return t ? Table.rehydrate({
      id: makeId<"Table">(t.id),
      number: t.number,
      label: t.label,
      qrCode: t.qrCode,
    }) : null;
  }

  async findTableByNumber(number: number): Promise<Table | null> {
    const r = await this.current();
    const t = await db.table.findUnique({
      where: { restaurantId_number: { restaurantId: r.id, number } },
    });
    return t ? Table.rehydrate({
      id: makeId<"Table">(t.id),
      number: t.number,
      label: t.label,
      qrCode: t.qrCode,
    }) : null;
  }

  /** Update the cached restaurant config. Bypasses the cache invalidation question
      since each deploy is single-tenant — restart picks up changes. */
  async updateWaiterCapacity(capacity: number): Promise<void> {
    await db.restaurant.update({
      where: { slug: env.RESTAURANT_SLUG },
      data: { waiterCapacity: Math.max(1, Math.min(99, Math.floor(capacity))) },
    });
    cached = null; // invalidate cache
  }
}
