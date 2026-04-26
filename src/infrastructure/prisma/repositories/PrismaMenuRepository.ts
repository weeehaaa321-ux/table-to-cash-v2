import { db } from "../client";
import { env } from "../../config/env";
import type { MenuRepository } from "@/application/ports/MenuRepository";
import type { Category } from "@/domain/menu/Category";
import type { MenuItem } from "@/domain/menu/MenuItem";
import type { AddOn } from "@/domain/menu/AddOn";
import { mapCategory, mapMenuItem, mapAddOn } from "../mappers/menuMappers";

/**
 * Prisma-backed implementation of MenuRepository.
 *
 * All queries scope by the current restaurant via the slug → id lookup
 * cached at module level (single-tenant per deploy means this is a
 * one-time fetch per process).
 */
let cachedRestaurantId: string | null = null;

async function getRestaurantId(): Promise<string> {
  if (cachedRestaurantId) return cachedRestaurantId;
  const r = await db.restaurant.findUnique({
    where: { slug: env.RESTAURANT_SLUG },
    select: { id: true },
  });
  if (!r) {
    throw new Error(`PrismaMenuRepository: no Restaurant with slug=${env.RESTAURANT_SLUG}`);
  }
  cachedRestaurantId = r.id;
  return r.id;
}

export class PrismaMenuRepository implements MenuRepository {
  async fetchFullMenu(): Promise<{
    categories: readonly Category[];
    itemsByCategory: ReadonlyMap<string, readonly MenuItem[]>;
    addOnsByItem: ReadonlyMap<string, readonly AddOn[]>;
  }> {
    const restaurantId = await getRestaurantId();
    const categoryRows = await db.category.findMany({
      where: { restaurantId },
      orderBy: { sortOrder: "asc" },
      include: {
        items: {
          orderBy: { sortOrder: "asc" },
          include: { addOns: true },
        },
      },
    });

    const categories = categoryRows.map(mapCategory);
    const itemsByCategory = new Map<string, MenuItem[]>();
    const addOnsByItem = new Map<string, AddOn[]>();

    for (const c of categoryRows) {
      const items = c.items.map(mapMenuItem);
      itemsByCategory.set(c.id, items);
      for (const item of c.items) {
        addOnsByItem.set(item.id, item.addOns.map(mapAddOn));
      }
    }

    return { categories, itemsByCategory, addOnsByItem };
  }

  async findItemById(id: string): Promise<MenuItem | null> {
    const row = await db.menuItem.findUnique({ where: { id } });
    return row ? mapMenuItem(row) : null;
  }

  async findCategoryById(id: string): Promise<Category | null> {
    const row = await db.category.findUnique({ where: { id } });
    return row ? mapCategory(row) : null;
  }

  async incrementItemViews(itemId: string, by = 1): Promise<void> {
    await db.menuItem.update({
      where: { id: itemId },
      data: { views: { increment: by } },
    });
  }
}
