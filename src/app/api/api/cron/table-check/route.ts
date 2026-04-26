import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { sendPushToStaff } from "@/lib/web-push";

// GET: Called by Vercel Cron every minute
// Finds check_table messages whose scheduled time has passed and sends push notifications
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const now = new Date();

    // Find all pending check_table messages
    const messages = await db.message.findMany({
      where: { type: "check_table" },
      select: { id: true, to: true, text: true, command: true },
    });

    let sent = 0;

    for (const msg of messages) {
      // Parse the scheduled time from the command field: "check_{orderId}_{isoDate}"
      const parts = msg.command?.split("_") || [];
      const isoDate = parts.slice(2).join("_"); // rejoin in case ISO has underscores
      const scheduledAt = new Date(isoDate);

      if (isNaN(scheduledAt.getTime()) || scheduledAt > now) continue;

      // Time has passed — send push and delete the message
      await sendPushToStaff(msg.to, {
        title: "Check Table",
        body: msg.text || "Time to check on your table",
        tag: `table-check-${msg.id}`,
        url: "/waiter",
      }).catch(() => {});

      await db.message.delete({ where: { id: msg.id } }).catch(() => {});
      sent++;
    }

    return NextResponse.json({ success: true, sent });
  } catch (err) {
    console.error("Table check cron failed:", err);
    return NextResponse.json({ error: "Cron failed" }, { status: 500 });
  }
}
