/**
 * Outbound transactional email. Backed by Resend's HTTP API when the
 * RESEND_API_KEY env var is set; otherwise no-ops with a console log
 * so the rest of the app keeps working before the API key is
 * provisioned.
 *
 * Every attempt is recorded in the MailLog table. If Resend rejects
 * or throws, the row is marked FAILED and the retry cron picks it
 * up later (up to 3 attempts before ABANDONED). Each successful
 * send writes the provider message id back so support tickets can
 * cross-reference Resend's dashboard.
 *
 * Why Resend (vs SES / SendGrid / Mailgun): the simplest-to-set-up
 * developer-friendly option in 2026, has a free tier that comfortably
 * covers a small hotel's volume, and exposes a plain HTTP API so we
 * don't pull a heavy SDK into our bundle.
 *
 * Required env:
 *   RESEND_API_KEY    — get from https://resend.com (free tier OK)
 * Optional env:
 *   EMAIL_FROM_DEFAULT — fallback "From" when Hotel.emailFrom is null
 */

import { db } from "@/lib/db";

export type SendEmailInput = {
  from: string;
  to: string | string[];
  subject: string;
  html: string;
  text?: string;
  replyTo?: string;
  bcc?: string | string[];
  /** Hotel id for indexing / per-hotel reporting. Optional. */
  hotelId?: string | null;
};

/**
 * Send-and-log. Always creates a MailLog row first (status PENDING),
 * then attempts Resend, then flips the row to SENT or FAILED based
 * on outcome. Returning ok=false here is non-fatal for callers —
 * they can `.catch` and continue, and the retry cron picks it up.
 */
export async function sendEmail(
  input: SendEmailInput
): Promise<{ ok: boolean; id?: string; error?: string; mailLogId?: string }> {
  const toAddress = Array.isArray(input.to) ? input.to[0] : input.to;
  const log = await db.mailLog.create({
    data: {
      hotelId: input.hotelId ?? null,
      toAddress,
      fromAddress: input.from,
      subject: input.subject,
      payload: {
        html: input.html,
        text: input.text ?? null,
        replyTo: input.replyTo ?? null,
        bcc: input.bcc ?? null,
        toFull: input.to,
      },
    },
  });

  return await attemptSend(log.id, input);
}

/**
 * Try to send a single MailLog row. Pure function in terms of
 * application state: it reads RESEND_API_KEY, calls Resend, and
 * updates the MailLog row. The retry cron reuses this directly.
 */
export async function attemptSend(
  mailLogId: string,
  input: SendEmailInput
): Promise<{ ok: boolean; id?: string; error?: string; mailLogId: string }> {
  const apiKey = process.env.RESEND_API_KEY;
  const now = new Date();

  if (!apiKey) {
    // No API key configured. Log a warning and mark the row FAILED;
    // the cron will keep retrying until the key is added (up to 3
    // attempts after which the row is ABANDONED).
    await db.mailLog.update({
      where: { id: mailLogId },
      data: {
        status: "FAILED",
        attempts: { increment: 1 },
        lastError: "RESEND_API_KEY not set",
        lastAttemptAt: now,
      },
    });
    console.warn(
      `[email] RESEND_API_KEY not set; logged but not sent — "${input.subject}"`
    );
    return { ok: false, error: "no_api_key", mailLogId };
  }

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: input.from,
        to: input.to,
        subject: input.subject,
        html: input.html,
        text: input.text,
        reply_to: input.replyTo,
        bcc: input.bcc,
      }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      const errorMsg = `${res.status}: ${text.slice(0, 500)}`;
      await db.mailLog.update({
        where: { id: mailLogId },
        data: {
          status: "FAILED",
          attempts: { increment: 1 },
          lastError: errorMsg,
          lastAttemptAt: now,
        },
      });
      console.error(`[email] send failed (${res.status}): ${text}`);
      return { ok: false, error: errorMsg, mailLogId };
    }
    const data = await res.json().catch(() => ({}));
    await db.mailLog.update({
      where: { id: mailLogId },
      data: {
        status: "SENT",
        attempts: { increment: 1 },
        sentAt: now,
        lastAttemptAt: now,
        providerId: data.id ?? null,
        lastError: null,
      },
    });
    return { ok: true, id: data.id, mailLogId };
  } catch (e) {
    const errorMsg = e instanceof Error ? e.message : String(e);
    await db.mailLog.update({
      where: { id: mailLogId },
      data: {
        status: "FAILED",
        attempts: { increment: 1 },
        lastError: errorMsg,
        lastAttemptAt: now,
      },
    });
    console.error("[email] send threw:", e);
    return { ok: false, error: errorMsg, mailLogId };
  }
}

/** Pick the right "From" header: hotel-specific override > env
 *  default > Resend's sandbox sender. Always pass a sensible fallback
 *  so even un-verified domains still send. */
export function pickFromAddress(hotelEmailFrom: string | null | undefined): string {
  return (
    hotelEmailFrom ||
    process.env.EMAIL_FROM_DEFAULT ||
    "Neom Hotel <onboarding@resend.dev>"
  );
}

// ─── Templates ─────────────────────────────────────────────────────
//
// Plain-HTML, no template engine — these are short and the inline
// styles keep them rendering correctly across Gmail / Outlook /
// Apple Mail without any framework. Bilingual (English up top so
// we don't lose foreign guests) with Arabic mirroring below.

function escapeHtml(s: string | null | undefined): string {
  if (!s) return "";
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function shell(content: string): string {
  return `<!doctype html><html><body style="margin:0;padding:0;background:#f7f5f1;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#1a1f2c">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f7f5f1;padding:32px 16px">
  <tr><td align="center">
    <table width="560" cellpadding="0" cellspacing="0" style="background:#fff;border:1px solid #e8e3d9;border-radius:14px;overflow:hidden;max-width:100%">
      ${content}
    </table>
  </td></tr>
</table></body></html>`;
}

export function renderBookingConfirmationEmail(args: {
  hotelName: string;
  guestName: string;
  roomNumber: string;
  roomTypeName: string;
  checkInDate: string;
  checkOutDate: string;
  nights: number;
  totalEstimate: number;
  bookingRef: string;
  checkInTime?: string;
  checkOutTime?: string;
}): { subject: string; html: string } {
  const subject = `Reservation confirmed at ${args.hotelName}`;
  const html = shell(`
    <tr><td style="padding:32px 32px 0">
      <p style="margin:0 0 8px;font-size:11px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:#c5a572">
        ${escapeHtml(args.hotelName)}
      </p>
      <h1 style="margin:0 0 16px;font-size:24px;font-weight:800">Reservation confirmed</h1>
      <p style="margin:0 0 16px;font-size:15px;color:#4a5160;line-height:1.6">
        ${escapeHtml(args.guestName.split(" ")[0])}, your room is ready when you are.
      </p>
    </td></tr>
    <tr><td style="padding:0 32px 16px">
      <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e8e3d9;border-radius:8px;overflow:hidden">
        <tr><td style="padding:14px 18px;background:#fbfaf6">
          <div style="font-size:11px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:#8a91a0">Stay</div>
          <div style="font-size:16px;font-weight:800;margin-top:2px">Room ${escapeHtml(args.roomNumber)} · ${escapeHtml(args.roomTypeName)}</div>
        </td></tr>
        <tr><td style="padding:14px 18px;border-top:1px solid #e8e3d9">
          <table width="100%"><tr>
            <td style="font-size:13px;color:#8a91a0;font-weight:700;text-transform:uppercase;letter-spacing:0.05em">Check in</td>
            <td style="font-size:15px;font-weight:800;text-align:right">${escapeHtml(args.checkInDate)}${args.checkInTime ? ` from ${escapeHtml(args.checkInTime)}` : ""}</td>
          </tr></table>
        </td></tr>
        <tr><td style="padding:14px 18px;border-top:1px solid #e8e3d9">
          <table width="100%"><tr>
            <td style="font-size:13px;color:#8a91a0;font-weight:700;text-transform:uppercase;letter-spacing:0.05em">Check out</td>
            <td style="font-size:15px;font-weight:800;text-align:right">${escapeHtml(args.checkOutDate)}${args.checkOutTime ? ` by ${escapeHtml(args.checkOutTime)}` : ""}</td>
          </tr></table>
        </td></tr>
        <tr><td style="padding:14px 18px;border-top:1px solid #e8e3d9">
          <table width="100%"><tr>
            <td style="font-size:13px;color:#8a91a0;font-weight:700;text-transform:uppercase;letter-spacing:0.05em">Estimated total</td>
            <td style="font-size:15px;font-weight:800;text-align:right">${args.totalEstimate.toLocaleString("en-EG")} EGP · ${args.nights} night${args.nights === 1 ? "" : "s"}</td>
          </tr></table>
        </td></tr>
        <tr><td style="padding:14px 18px;border-top:1px solid #e8e3d9;background:#fbfaf6">
          <table width="100%"><tr>
            <td style="font-size:13px;color:#8a91a0;font-weight:700;text-transform:uppercase;letter-spacing:0.05em">Booking ref</td>
            <td style="font-size:13px;font-family:monospace;text-align:right">${escapeHtml(args.bookingRef)}</td>
          </tr></table>
        </td></tr>
      </table>
    </td></tr>
    <tr><td style="padding:8px 32px 32px;font-size:13px;color:#4a5160;line-height:1.7">
      <p style="margin:0 0 12px">
        No payment now — you'll settle at check-out. Add-ons during your stay
        (cafe, kayak, massage, etc.) can be charged to your room.
      </p>
      <p style="margin:0;color:#8a91a0;font-size:12px">
        Plans changed? Reply to this email and we'll handle it.
      </p>
    </td></tr>
  `);
  return { subject, html };
}

export function renderCheckInWelcomeEmail(args: {
  hotelName: string;
  guestName: string;
  roomNumber: string;
  stayLink: string;
  checkOutDate: string;
  checkOutTime: string;
}): { subject: string; html: string } {
  const subject = `Welcome to ${args.hotelName} — Room ${args.roomNumber}`;
  const html = shell(`
    <tr><td style="padding:32px 32px 0">
      <h1 style="margin:0 0 16px;font-size:24px;font-weight:800">
        Welcome, ${escapeHtml(args.guestName.split(" ")[0])}.
      </h1>
      <p style="margin:0 0 16px;font-size:15px;color:#4a5160;line-height:1.6">
        You're checked into <strong>Room ${escapeHtml(args.roomNumber)}</strong>. Check-out is ${escapeHtml(args.checkOutDate)} by ${escapeHtml(args.checkOutTime)}.
      </p>
      <p style="margin:0 0 24px;font-size:15px;color:#4a5160;line-height:1.6">
        Track your folio in real time at the link below. Anything you charge
        to your room (cafe orders, activities, minibar) shows up immediately.
      </p>
      <a href="${escapeHtml(args.stayLink)}" style="display:inline-block;background:#c5a572;color:#fff;font-weight:800;text-decoration:none;padding:12px 22px;border-radius:8px;font-size:14px">
        View my folio →
      </a>
    </td></tr>
    <tr><td style="padding:32px;font-size:13px;color:#8a91a0;line-height:1.6">
      Save this link — your folio updates live, and at checkout it shows the
      final amount paid.
    </td></tr>
  `);
  return { subject, html };
}

export function renderCheckOutReceiptEmail(args: {
  hotelName: string;
  guestName: string;
  roomNumber: string;
  checkInDate: string;
  checkOutDate: string;
  charges: Array<{ description: string; amount: number; type: string }>;
  total: number;
  paymentMethod: string;
}): { subject: string; html: string } {
  const subject = `Receipt — ${args.hotelName} (Room ${args.roomNumber})`;
  const lines = args.charges
    .map(
      (c) => `
        <tr>
          <td style="padding:8px 0;font-size:13px;color:#4a5160">${escapeHtml(c.description)}</td>
          <td style="padding:8px 0;font-size:13px;font-weight:700;text-align:right;color:#1a1f2c">${c.amount.toLocaleString("en-EG")}</td>
        </tr>`
    )
    .join("");
  const html = shell(`
    <tr><td style="padding:32px 32px 0">
      <p style="margin:0 0 8px;font-size:11px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:#c5a572">
        ${escapeHtml(args.hotelName)}
      </p>
      <h1 style="margin:0 0 16px;font-size:24px;font-weight:800">Thank you, ${escapeHtml(args.guestName.split(" ")[0])}.</h1>
      <p style="margin:0 0 16px;font-size:15px;color:#4a5160;line-height:1.6">
        Receipt for Room ${escapeHtml(args.roomNumber)} · ${escapeHtml(args.checkInDate)} → ${escapeHtml(args.checkOutDate)}.
      </p>
    </td></tr>
    <tr><td style="padding:0 32px 16px">
      <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e8e3d9;border-radius:8px;padding:8px 18px">
        ${lines}
        <tr><td colspan="2" style="border-top:2px solid #1a1f2c;padding-top:8px;margin-top:8px"></td></tr>
        <tr>
          <td style="padding:8px 0;font-size:15px;font-weight:800">Total — paid via ${escapeHtml(args.paymentMethod.toLowerCase())}</td>
          <td style="padding:8px 0;font-size:18px;font-weight:800;text-align:right">${args.total.toLocaleString("en-EG")} EGP</td>
        </tr>
      </table>
    </td></tr>
    <tr><td style="padding:8px 32px 32px;font-size:13px;color:#4a5160;line-height:1.7">
      <p style="margin:0">
        Thanks for staying with us. Come back soon.
      </p>
    </td></tr>
  `);
  return { subject, html };
}
