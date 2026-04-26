import webpush from "web-push";
import { db } from "./db";

const VAPID_PUBLIC = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || "";
const VAPID_PRIVATE = process.env.VAPID_PRIVATE_KEY || "";
const rawSubject = process.env.VAPID_SUBJECT || "mailto:admin@tableto.cash";
const VAPID_SUBJECT = rawSubject.startsWith("mailto:") ? rawSubject : `mailto:${rawSubject}`;

if (VAPID_PUBLIC && VAPID_PRIVATE) {
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE);
}

export type PushPayload = {
  title: string;
  body: string;
  tag?: string;
  url?: string;
  icon?: string;
};

async function sendToSubscription(sub: { id: string; endpoint: string; p256dh: string; auth: string }, payload: PushPayload) {
  try {
    await webpush.sendNotification(
      { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
      JSON.stringify(payload),
      { TTL: 3600 }
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
    select: { id: true, endpoint: true, p256dh: true, auth: true },
  });
  await Promise.allSettled(subs.map((s) => sendToSubscription(s, payload)));
}

export async function sendPushToRole(role: string, restaurantId: string, payload: PushPayload) {
  const subs = await db.pushSubscription.findMany({
    where: { role, restaurantId },
    select: { id: true, endpoint: true, p256dh: true, auth: true },
  });
  await Promise.allSettled(subs.map((s) => sendToSubscription(s, payload)));
}

export async function sendPushToRestaurant(restaurantId: string, payload: PushPayload) {
  const subs = await db.pushSubscription.findMany({
    where: { restaurantId },
    select: { id: true, endpoint: true, p256dh: true, auth: true },
  });
  await Promise.allSettled(subs.map((s) => sendToSubscription(s, payload)));
}
