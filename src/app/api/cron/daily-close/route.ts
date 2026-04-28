import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { nowInRestaurantTz } from "@/lib/restaurant-config";
import { cairoDateOnly, persistClose } from "@/lib/daily-close";

// GET: Vercel Cron entrypoint. Closes any unclosed business days from
// yesterday going back up to BACKFILL_DAYS. Idempotent — re-running is
// safe; existing closes are left untouched.
//
// Why backfill instead of "just yesterday": if the cron was offline or
// blocked (deploy gap, env var missing, region outage), we don't want
// the books to permanently miss those days. Seven days is enough room
// for any realistic recovery without quietly resurrecting numbers from
// a long-forgotten incident.
const BACKFILL_DAYS = 7;
const SYSTEM_SIGNER = "Auto-close";

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Compute the target window in restaurant-local time.
  const cairoNow = nowInRestaurantTz(new Date());
  // "Yesterday" = the business day that just ended. The cron is meant
  // to run at ~5am Cairo, so this is the previous calendar day.
  const yesterday = cairoDateOnly(
    new Date(Date.now() - 24 * 60 * 60 * 1000),
  );

  try {
    const restaurants = await db.restaurant.findMany({
      select: { id: true, slug: true },
    });

    const results: {
      restaurant: string;
      closed: string[];
      skipped: string[];
      errors: string[];
    }[] = [];

    for (const r of restaurants) {
      const closed: string[] = [];
      const skipped: string[] = [];
      const errors: string[] = [];

      for (let i = 0; i < BACKFILL_DAYS; i++) {
        const target = new Date(
          yesterday.getTime() - i * 24 * 60 * 60 * 1000,
        );
        const iso = target.toISOString().slice(0, 10);
        try {
          const result = await persistClose({
            restaurantId: r.id,
            target,
            closedById: null,
            closedByName: SYSTEM_SIGNER,
          });
          if (result.kind === "ok") {
            closed.push(iso);
          } else {
            skipped.push(iso);
          }
        } catch (err) {
          console.error(
            `[cron daily-close] ${r.slug} ${iso} failed:`,
            err,
          );
          errors.push(iso);
        }
      }

      results.push({ restaurant: r.slug, closed, skipped, errors });
    }

    return NextResponse.json({
      success: true,
      ranAt: cairoNow.toISOString(),
      results,
    });
  } catch (err) {
    console.error("[cron daily-close] failed:", err);
    return NextResponse.json({ error: "Cron failed" }, { status: 500 });
  }
}
