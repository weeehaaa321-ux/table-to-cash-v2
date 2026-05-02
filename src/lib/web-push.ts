import webpush from "web-push";
import { db } from "./db";

const VAPID_PUBLIC = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || "";
const VAPID_PRIVATE = process.env.VAPID_PRIVATE_KEY || "";
const rawSubject = process.env.VAPID_SUBJECT || "mailto:admin@tableto.cash";
const VAPID_SUBJECT = rawSubject.startsWith("mailto:") ? rawSubject : `mailto:${rawSubject}`;

if (VAPID_PUBLIC && VAPID_PRIVATE) {
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE);
}

// Either a plain string (treated as English-only) or a bilingual
// `{ en, ar }` object that the helper picks from based on the
// subscription's stored language. Strings are accepted so existing
// call sites don't all have to change at once — they just send in
// whatever language they already had.
export type NotifText = string | { en: string; ar: string };

export type PushPayload = {
  title: NotifText;
  body: NotifText;
  tag?: string;
  url?: string;
  icon?: string;
};

function pickLang(text: NotifText, lang: string): string {
  if (typeof text === "string") return text;
  return lang === "ar" ? text.ar : text.en;
}

async function sendToSubscription(
  sub: { id: string; endpoint: string; p256dh: string; auth: string; lang: string },
  payload: PushPayload,
) {
  try {
    const resolved = {
      title: pickLang(payload.title, sub.lang),
      body: pickLang(payload.body, sub.lang),
      tag: payload.tag,
      url: payload.url,
      icon: payload.icon,
    };
    await webpush.sendNotification(
      { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
      JSON.stringify(resolved),
      {
        TTL: 3600,
        // urgency=high forces FCM to wake the device + bypass
        // some Android Doze / battery-saving suppression that was
        // silently dropping our default-priority pushes. Without
        // this, pushes were being delivered and showing only when
        // Chrome happened to be foregrounded.
        urgency: "high",
      }
    );
  } catch (err: unknown) {
    const statusCode = (err as { statusCode?: number }).statusCode;
    if (statusCode === 410 || statusCode === 404) {
      // Subscription expired — clean up
      await db.pushSubscription.delete({ where: { id: sub.id } }).catch(() => {});
    }
  }
}

export async function sendPushToStaff(staffId: string, payload: PushPayload) {
  const subs = await db.pushSubscription.findMany({
    where: { staffId },
    select: { id: true, endpoint: true, p256dh: true, auth: true, lang: true },
  });
  await Promise.allSettled(subs.map((s) => sendToSubscription(s, payload)));
}

export async function sendPushToRole(role: string, restaurantId: string, payload: PushPayload) {
  const subs = await db.pushSubscription.findMany({
    where: { role, restaurantId },
    select: { id: true, endpoint: true, p256dh: true, auth: true, lang: true },
  });
  await Promise.allSettled(subs.map((s) => sendToSubscription(s, payload)));
}

export async function sendPushToRestaurant(restaurantId: string, payload: PushPayload) {
  const subs = await db.pushSubscription.findMany({
    where: { restaurantId },
    select: { id: true, endpoint: true, p256dh: true, auth: true, lang: true },
  });
  await Promise.allSettled(subs.map((s) => sendToSubscription(s, payload)));
}
