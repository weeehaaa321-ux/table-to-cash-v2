import { db } from "@/lib/db";

export class MenuAdminUseCases {
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

  async listCategories(restaurantId: string) {
    return db.category.findMany({
      where: { restaurantId },
      orderBy: { sortOrder: "asc" },
    });
  }
}
