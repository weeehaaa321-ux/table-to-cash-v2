import { db } from "@/lib/db";

type SubscribeInput = {
  endpoint: string;
  p256dh: string;
  auth: string;
  staffId: string | null;
  role: string | null;
  restaurantId: string;
  /** "en" or "ar" — the device's UI language at subscribe time. Falls
   *  back to "en" if not provided. Updated on every re-subscribe so
   *  toggling the language in the UI propagates here. */
  lang?: string;
};

export class PushSubscriptionUseCases {
  async subscribe(data: SubscribeInput) {
    const lang = data.lang === "ar" ? "ar" : "en";
    const result = await db.pushSubscription.upsert({
      where: { endpoint: data.endpoint },
      create: { ...data, lang },
      update: {
        p256dh: data.p256dh,
        auth: data.auth,
        staffId: data.staffId,
        role: data.role,
        lang,
      },
    });
    // Stale-endpoint cleanup, copied from v1's working flow:
    // when a staff logs in on a new browser/phone, the old
    // subscription endpoint is dead but stays in the DB and
    // sendPushToStaff would still try (and fail) to deliver to
    // it. Remove every other subscription this staff had so
    // sends only target the live device.
    if (data.staffId) {
      await db.pushSubscription.deleteMany({
        where: { staffId: data.staffId, endpoint: { not: data.endpoint } },
      });
    }
    return result;
  }

  async unsubscribe(endpoint: string) {
    return db.pushSubscription.deleteMany({ where: { endpoint } });
  }
}
