import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { attemptSend } from "@/lib/email";

/**
 * GET /api/cron/mail-retry
 *
 * Retries failed transactional emails up to 3 attempts total. After
 * the 3rd failure the row is marked ABANDONED so we stop hammering
 * a permanently-broken send (bad recipient, blocked sender, etc.).
 *
 * Look-back window: 24 hours. Older failures are left as-is —
 * resending a confirmation email more than a day after booking is
 * usually worse than not resending.
 *
 * Schedule (vercel.json): every 15 minutes is a reasonable balance
 * between rapid recovery from transient Resend hiccups and not
 * spamming.
 */
export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = request.headers.get("authorization") || "";
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const cutoff = new Date();
  cutoff.setHours(cutoff.getHours() - 24);

  const failed = await db.mailLog.findMany({
    where: {
      status: "FAILED",
      attempts: { lt: 3 },
      createdAt: { gte: cutoff },
    },
    orderBy: { createdAt: "asc" },
    take: 50, // batch cap so a backlog doesn't blow our request time
  });

  let retried = 0;
  let recovered = 0;
  let abandoned = 0;
  for (const row of failed) {
    const payload = row.payload as {
      html: string;
      text: string | null;
      replyTo: string | null;
      bcc: string | string[] | null;
      toFull: string | string[];
    };
    const result = await attemptSend(row.id, {
      from: row.fromAddress,
      to: payload.toFull ?? row.toAddress,
      subject: row.subject,
      html: payload.html,
      text: payload.text ?? undefined,
      replyTo: payload.replyTo ?? undefined,
      bcc: payload.bcc ?? undefined,
      hotelId: row.hotelId,
    });
    retried++;
    if (result.ok) {
      recovered++;
    } else {
      // attemptSend already incremented attempts. If we're now at 3,
      // mark abandoned.
      const refreshed = await db.mailLog.findUnique({
        where: { id: row.id },
        select: { attempts: true, status: true },
      });
      if (refreshed && refreshed.attempts >= 3 && refreshed.status === "FAILED") {
        await db.mailLog.update({
          where: { id: row.id },
          data: { status: "ABANDONED" },
        });
        abandoned++;
      }
    }
  }

  return NextResponse.json({
    ok: true,
    retried,
    recovered,
    abandoned,
    pending: failed.length === 50 ? "more" : "none",
  });
}
