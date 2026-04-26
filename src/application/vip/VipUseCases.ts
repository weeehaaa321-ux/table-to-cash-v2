import { db } from "@/lib/db";

export class VipUseCases {
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
