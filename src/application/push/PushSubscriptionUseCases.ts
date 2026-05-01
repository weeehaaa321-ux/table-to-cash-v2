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
    return db.pushSubscription.upsert({
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
  }

  async unsubscribe(endpoint: string) {
    return db.pushSubscription.deleteMany({ where: { endpoint } });
  }
}
