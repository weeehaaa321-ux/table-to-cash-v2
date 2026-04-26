import { db } from "@/lib/db";

export class PushSubscriptionUseCases {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async subscribe(data: any) {
    return db.pushSubscription.upsert({
      where: { endpoint: data.endpoint },
      create: data,
      update: {
        p256dh: data.p256dh,
        auth: data.auth,
        staffId: data.staffId,
        role: data.role,
      },
    });
  }

  async unsubscribe(endpoint: string) {
    return db.pushSubscription.deleteMany({ where: { endpoint } });
  }
}
