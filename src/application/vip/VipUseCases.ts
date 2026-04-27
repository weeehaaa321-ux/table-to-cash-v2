import { db } from "@/lib/db";

export class VipUseCases {
  async resolveRestaurantId(id: string): Promise<string | null> {
    if (!id) return null;
    if (id.startsWith("c") && id.length > 10) return id;
    const r = await db.restaurant.findUnique({ where: { slug: id }, select: { id: true } });
    return r?.id || null;
  }

  /** Admin/staff list — all guests in a restaurant including inactive. */
  async listAllForAdmin(restaurantId: string) {
    return db.vipGuest.findMany({
      where: { restaurantId },
      orderBy: { createdAt: "desc" },
    });
  }

  /** Pre-delete check: number of orders + open sessions for this VIP. */
  async countOrdersAndOpenSessions(vipGuestId: string): Promise<{
    orderCount: number;
    openSessions: number;
  }> {
    const [orderCount, openSessions] = await Promise.all([
      db.order.count({ where: { vipGuestId } }),
      db.tableSession.count({ where: { vipGuestId, status: "OPEN" } }),
    ]);
    return { orderCount, openSessions };
  }

  async hardDelete(id: string) {
    return db.vipGuest.delete({ where: { id } });
  }

  async listAll(restaurantId: string) {
    return db.vipGuest.findMany({
      where: { restaurantId, active: true },
      orderBy: { createdAt: "desc" },
    });
  }

  async findByToken(token: string) {
    return db.vipGuest.findUnique({
      where: { linkToken: token },
      include: { restaurant: { select: { name: true, slug: true, currency: true } } },
    });
  }

  async findByTokenWithRestaurantId(token: string) {
    return db.vipGuest.findUnique({
      where: { linkToken: token },
      include: { restaurant: { select: { id: true, name: true, slug: true, currency: true } } },
    });
  }

  async updateByToken(token: string, data: Record<string, unknown>) {
    return db.vipGuest.update({ where: { linkToken: token }, data });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async create(data: any) {
    return db.vipGuest.create({ data });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async update(id: string, data: any) {
    return db.vipGuest.update({ where: { id }, data });
  }

  async deactivate(id: string) {
    return db.vipGuest.update({ where: { id }, data: { active: false } });
  }
}
