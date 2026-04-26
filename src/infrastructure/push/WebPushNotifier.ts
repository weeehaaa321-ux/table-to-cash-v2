import webpush from "web-push";
import { db } from "../prisma/client";
import { env } from "../config/env";
import type { PushNotifier, PushPayload } from "@/application/ports/PushNotifier";
import type { StaffRole } from "@/domain/staff/enums";

/**
 * Web Push notifier.
 *
 * Source repo: src/lib/web-push.ts. Same VAPID setup, same payload
 * shape, same error handling (drop subscriptions that return 404/410).
 *
 * VAPID keys come from env (per-deploy, not per-tenant). Subjects
 * default to `mailto:admin@example.com` if not set.
 */
let vapidConfigured = false;

function configureVapidOnce() {
  if (vapidConfigured) return;
  const publicKey = env.VAPID_PUBLIC_KEY;
  const privateKey = env.serverOnly.vapidPrivateKey();
  const subject = env.serverOnly.vapidSubject();
  if (!publicKey || !privateKey) {
    throw new Error("WebPushNotifier: VAPID keys not configured");
  }
  webpush.setVapidDetails(subject, publicKey, privateKey);
  vapidConfigured = true;
}

export class WebPushNotifier implements PushNotifier {
  async notifyRole(role: StaffRole, payload: PushPayload): Promise<void> {
    configureVapidOnce();
    const subs = await db.pushSubscription.findMany({
      where: { role },
    });
    await Promise.all(subs.map((s) => this.send(s, payload)));
  }

  async notifyStaff(staffId: string, payload: PushPayload): Promise<void> {
    configureVapidOnce();
    const subs = await db.pushSubscription.findMany({
      where: { staffId },
    });
    await Promise.all(subs.map((s) => this.send(s, payload)));
  }

  private async send(
    sub: { id: string; endpoint: string; p256dh: string; auth: string },
    payload: PushPayload,
  ): Promise<void> {
    try {
      await webpush.sendNotification(
        {
          endpoint: sub.endpoint,
          keys: { p256dh: sub.p256dh, auth: sub.auth },
        },
        JSON.stringify(payload),
      );
    } catch (err: unknown) {
      // 404/410 = subscription gone (uninstalled, expired). Drop it
      // so we don't keep retrying. Other errors bubble up.
      const status = (err as { statusCode?: number })?.statusCode;
      if (status === 404 || status === 410) {
        await db.pushSubscription.delete({ where: { id: sub.id } }).catch(() => {});
        return;
      }
      throw err;
    }
  }
}
