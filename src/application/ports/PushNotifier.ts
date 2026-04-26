import type { StaffRole } from "@/domain/staff/enums";

/**
 * Server-side push notification port. Implemented by
 * infrastructure/push/WebPushNotifier.ts (web-push lib).
 *
 * Source repo: src/lib/web-push.ts + push-client.ts.
 */
export interface PushNotifier {
  /** Send to all subscribers in a role (e.g. all WAITERs). */
  notifyRole(role: StaffRole, payload: PushPayload): Promise<void>;
  /** Send to a specific staff member. */
  notifyStaff(staffId: string, payload: PushPayload): Promise<void>;
}

export type PushPayload = {
  title: string;
  body: string;
  url?: string;
  icon?: string;
  tag?: string;
};
