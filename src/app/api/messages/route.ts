import { NextRequest, NextResponse } from "next/server";
import { useCases, ports } from "@/infrastructure/composition";
import { sendPushToStaff, sendPushToRole, sendPushToRestaurant } from "@/lib/web-push";
import type { MessageType, MessageCommand } from "@/domain/messaging/Message";

export async function POST(request: NextRequest) {
  const body = await request.json();
  try {
    const restaurantId = await useCases.sessions.resolveRestaurantId(
      body.restaurantId || process.env.NEXT_PUBLIC_RESTAURANT_SLUG || "neom-dahab",
    );
    if (!restaurantId) {
      return NextResponse.json({ error: "Restaurant not found" }, { status: 400 });
    }

    const msg = await useCases.sendMessage.execute({
      type: (body.type || "alert") as MessageType,
      from: body.from || "owner",
      to: body.to || "all",
      text: body.text || null,
      audio: body.audio || null,
      tableId: body.tableId || null,
      orderId: body.orderId || null,
      command: (body.command || null) as MessageCommand | null,
    });

    if (!body.skipPush) {
      // CRITICAL: await the push sends.
      //
      // VNs go to ONE staffId → sendPushToStaff makes a single
      // webpush call that finishes in <500ms. Commands go to
      // "all" → sendPushToRestaurant fires N parallel webpush
      // calls. With fire-and-forget (.catch()), Vercel was
      // free to terminate the serverless function as soon as
      // we returned the 201 — and any in-flight push to a
      // sub that hadn't yet been written to its socket got
      // dropped or stalled.
      //
      // That's why VNs felt fast (single push completed in
      // time) but commands felt slow (broadcast partially
      // truncated, devices toward the end of the iteration
      // got their push only when the next function invocation
      // happened to revive things).
      //
      // Awaiting adds ~200-500ms to the route's own response,
      // but the dashboard owner doesn't notice that — and the
      // waiters get pushes immediately instead of seconds late.
      // Build a bilingual push body so each device sees the
      // notification in its own language (web-push.ts pickLang
      // resolves to en/ar based on the subscription's stored
      // lang). The English string still goes into Message.text
      // in the DB so the in-app message log keeps reading it
      // verbatim — only the lock-screen body gets localized.
      const bilingualBody = (() => {
        const cmd: string | undefined = body.command;
        const t = body.tableId;
        const fallback = body.text || { en: "New message from manager", ar: "رسالة جديدة من المدير" };
        switch (cmd) {
          case "send_waiter":
            return t ? { en: `Go to Table ${t} — owner request`, ar: `اذهب إلى الطاولة ${t} — طلب من المالك` } : fallback;
          case "prioritize":
            return { en: `Priority — rush this order`, ar: `أولوية — أسرع بهذا الطلب` };
          case "push_menu":
            return t ? { en: `Push menu recommendations to Table ${t}`, ar: `أرسل توصيات المنيو لطاولة ${t}` } : fallback;
          case "cash_payment":
            return body.text || { en: `Cash collection requested`, ar: `طلب تحصيل نقدي` };
          default:
            // Voice notes + free-form owner text fall through to
            // whatever the dashboard sent. If it's bilingual already
            // (object with en/ar) pickLang handles it; if it's a
            // string we just use it as-is in both languages.
            return fallback;
        }
      })();

      const pushPromise = (async () => {
        if (body.command === "call_waiter" && body.tableId) {
          const payload = {
            title: {
              en: `Table ${body.tableId} — Needs Attention`,
              ar: `طاولة ${body.tableId} — تحتاج اهتمام`,
            },
            body: body.text || {
              en: `Table ${body.tableId} is calling the waiter`,
              ar: `طاولة ${body.tableId} تطلب الجرسون`,
            },
            tag: `call-waiter-${body.tableId}-${Date.now()}`,
            url: "/waiter",
          };
          try {
            const session = await useCases.sessions.findOpenSessionWaiter(body.tableId, restaurantId);
            if (session?.waiterId) await sendPushToStaff(session.waiterId, payload);
            else await sendPushToRole("WAITER", restaurantId, payload);
          } catch {
            await sendPushToRole("WAITER", restaurantId, payload);
          }
        } else {
          const titleByType = body.type === "voice"
            ? { en: "Voice Note", ar: "ملاحظة صوتية" }
            : body.command === "cash_payment"
              ? { en: "Cash Collection", ar: "تحصيل نقدي" }
              : { en: "Message", ar: "رسالة" };
          const payload = {
            title: titleByType,
            body: bilingualBody,
            tag: `msg-${msg.id}`,
            url: "/waiter",
          };
          if (msg.to === "all") await sendPushToRestaurant(restaurantId, payload);
          else if (msg.to === "kitchen") await sendPushToRole("KITCHEN", restaurantId, payload);
          else await sendPushToStaff(msg.to, payload);
        }
      })();
      // Cap how long we'll wait. Most pushes finish in well under
      // a second; if some endpoint is being weird we still want
      // to return the route response within 4s rather than hang.
      // The remaining sends keep running in the background; even
      // if Vercel terminates the function shortly after we return,
      // the overwhelming majority will have completed by then.
      await Promise.race([
        pushPromise.catch(() => {}),
        new Promise((resolve) => setTimeout(resolve, 4000)),
      ]);
    }

    const names = await ports.messageRepo.resolveStaffNames([msg.from, msg.to]);
    return NextResponse.json(
      {
        id: msg.id,
        type: msg.type,
        from: msg.from,
        to: msg.to,
        text: msg.text,
        audio: msg.audio,
        tableId: msg.tableId,
        orderId: msg.orderId,
        command: msg.command,
        fromName: names.get(msg.from) || msg.from,
        toName: names.get(msg.to) || msg.to,
        createdAt: msg.createdAt.getTime(),
      },
      { status: 201 },
    );
  } catch (err) {
    console.error("Failed to create message:", err);
    return NextResponse.json({ error: "Failed to send message" }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const since = parseInt(url.searchParams.get("since") || "0", 10);
  const to = url.searchParams.get("to");
  try {
    const { messages, namesByStaffId } = await useCases.pollMessages.execute(since, to);
    return NextResponse.json(
      messages.map((m) => ({
        id: m.id,
        type: m.type,
        from: m.from,
        to: m.to,
        text: m.text,
        audio: m.audio,
        tableId: m.tableId,
        orderId: m.orderId,
        command: m.command,
        fromName: namesByStaffId.get(m.from) || m.from,
        toName: namesByStaffId.get(m.to) || m.to,
        createdAt: m.createdAt.getTime(),
      })),
    );
  } catch (err) {
    console.error("Failed to fetch messages:", err);
    return NextResponse.json({ error: "Failed to fetch messages" }, { status: 500 });
  }
}
