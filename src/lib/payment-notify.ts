// Single source of truth for "who gets pinged about a pending payment
// confirmation". Used by:
//   - /api/sessions/pay POST           — fired immediately when guest taps Pay
//   - CronUseCases.notifyStuckPayments — fired 10+ min later if still pending
//
// Policy:
//   - Notify only cashiers scheduled for the CURRENT cashier shift
//     (or shift=0, the utility/unassigned slot). Off-shift cashiers
//     don't get pinged — they're not on the roster right now and a
//     buzz would be noise.
//   - Always include all on-shift cashiers in the push, whether
//     they're clocked in or not. The on-shift cashier is the
//     "assigned" handler; pushing to them so they know to come in is
//     part of the flow.
//   - If none of the on-shift cashiers is currently clocked in (or
//     no cashier is even scheduled for this shift), escalate: also
//     push to the OWNER role and the FLOOR_MANAGER role. They both
//     have confirmation authority via /api/sessions/pay PATCH and
//     can keep the table from sitting stuck.

import { db } from "./db";
import { sendPushToStaff, sendPushToRole, type NotifText } from "./web-push";
import { nowInRestaurantTz } from "./restaurant-config";

// Mirror of the staleness filter in ClockInOutUseCase. A shift open
// longer than this is treated as not-clocked-in here too — otherwise
// a phantom row would prevent escalation when the cashier really
// hasn't been on the floor for a day.
const STALE_HOURS = 24;

export type PaymentNotifyParams = {
  restaurantId: string;
  /** Plain string (English-only) or {en, ar} bilingual. The helpers in
   *  web-push.ts pick per recipient based on stored subscription lang. */
  title: NotifText;
  body: NotifText;
  /** Caller-stable prefix; per-recipient suffixes are appended so dismissing
   *  on one device doesn't dismiss elsewhere. */
  tagBase: string;
};

export async function notifyPaymentConfirmation(p: PaymentNotifyParams): Promise<void> {
  // Cashier shifts run two 12-hour blocks (00–12, 12–24 in restaurant TZ).
  const cairoHour = nowInRestaurantTz().getHours();
  const currentCashierShift = cairoHour < 12 ? 1 : 2;

  const onShiftCashiers = await db.staff.findMany({
    where: {
      restaurantId: p.restaurantId,
      role: "CASHIER",
      active: true,
      shift: { in: [currentCashierShift, 0] },
    },
    select: { id: true },
  });

  // No cashier is even scheduled for this shift — straight to escalation.
  if (onShiftCashiers.length === 0) {
    await escalateToOwnerAndFloor(p);
    return;
  }

  // Are any of the on-shift cashiers actually on the floor?
  const cutoff = new Date(Date.now() - STALE_HOURS * 60 * 60 * 1000);
  const clocked = await db.staffShift.findMany({
    where: {
      restaurantId: p.restaurantId,
      clockOut: null,
      clockIn: { gte: cutoff },
      staffId: { in: onShiftCashiers.map((c) => c.id) },
    },
    select: { staffId: true },
  });
  const anyClockedIn = clocked.length > 0;

  // Always notify every on-shift cashier directly. The push IS the
  // assignment — they know to come in (or to confirm from wherever
  // they are) because their phone is the one buzzing.
  await Promise.all(
    onShiftCashiers.map((c) =>
      sendPushToStaff(c.id, {
        title: p.title,
        body: p.body,
        tag: `${p.tagBase}-cashier-${c.id}`,
        url: "/cashier",
      }).catch(() => {}),
    ),
  );

  // Cashier scheduled but not on the floor → escalate so the table
  // doesn't sit stuck while the cashier is en route.
  if (!anyClockedIn) {
    await escalateToOwnerAndFloor(p);
  }
}

async function escalateToOwnerAndFloor(p: PaymentNotifyParams): Promise<void> {
  // Compose the "no cashier on the floor" suffix in both languages
  // and stitch onto whatever shape the caller's body is.
  const noCashierSuffixEn = " (No cashier on the floor right now.)";
  const noCashierSuffixAr = " (لا يوجد كاشير على الأرض الآن.)";
  const composeBody = (base: NotifText): NotifText => {
    if (typeof base === "string") return base + noCashierSuffixEn;
    return { en: base.en + noCashierSuffixEn, ar: base.ar + noCashierSuffixAr };
  };
  const escalationBody = composeBody(p.body);
  await Promise.all([
    sendPushToRole("OWNER", p.restaurantId, {
      title: p.title,
      body: escalationBody,
      tag: `${p.tagBase}-owner`,
      url: "/dashboard",
    }).catch(() => {}),
    sendPushToRole("FLOOR_MANAGER", p.restaurantId, {
      title: p.title,
      body: escalationBody,
      tag: `${p.tagBase}-floor`,
      url: "/floor",
    }).catch(() => {}),
  ]);
}
