import { db } from "@/lib/db";

export class MenuAdminUseCases {
  async resolveRestaurantId(id: string): Promise<string | null> {
    if (!id) return null;
    if (id.startsWith("c") && id.length > 10) return id;
    const r = await db.restaurant.findUnique({ where: { slug: id }, select: { id: true } });
    return r?.id || null;
  }

  /** Admin tree: every category + every item including unavailable. */
  async listCategoriesWithItems(restaurantId: string) {
    return db.category.findMany({
      where: { restaurantId },
      orderBy: { sortOrder: "asc" },
      include: {
        items: { orderBy: { sortOrder: "asc" } },
      },
    });
  }

  /** Soft-delete fallback: number of historical references blocks a hard delete. */
  async countOrderItemsForMenuItem(menuItemId: string): Promise<number> {
    return db.orderItem.count({ where: { menuItemId } });
  }

  async deleteItemAndAddOns(id: string) {
    await db.addOn.deleteMany({ where: { menuItemId: id } });
    return db.menuItem.delete({ where: { id } });
  }

  async deactivateItem(id: string) {
    return db.menuItem.update({ where: { id }, data: { available: false } });
  }

  // ─── Items ────────────────────────────────────
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async createItem(data: any) {
    return db.menuItem.create({ data });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async updateItem(id: string, data: any) {
    return db.menuItem.update({ where: { id }, data });
  }

  async deleteItem(id: string) {
    return db.menuItem.delete({ where: { id } });
  }

  // ─── Categories ───────────────────────────────
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async createCategory(data: any) {
    return db.category.create({ data });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async updateCategory(id: string, data: any) {
    return db.category.update({ where: { id }, data });
  }

  async deleteCategory(id: string) {
    return db.category.delete({ where: { id } });
  }

  /** Cascade delete: drop add-ons + items inside a category before removing it. */
  async deleteCategoryWithItems(id: string): Promise<{ deletedItems: number }> {
    const items = await db.menuItem.findMany({
      where: { categoryId: id },
      select: { id: true },
    });
    if (items.length > 0) {
      const itemIds = items.map((i) => i.id);
      await db.addOn.deleteMany({ where: { menuItemId: { in: itemIds } } });
      await db.menuItem.deleteMany({ where: { categoryId: id } });
    }
    await db.category.delete({ where: { id } });
    return { deletedItems: items.length };
  }

  async listCategories(restaurantId: string) {
    return db.category.findMany({
      where: { restaurantId },
      orderBy: { sortOrder: "asc" },
    });
  }
}
