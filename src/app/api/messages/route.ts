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
      if (body.command === "call_waiter" && body.tableId) {
        const payload = {
          title: `Table ${body.tableId} — Needs Attention`,
          body: body.text || `Table ${body.tableId} is calling the waiter`,
          tag: `call-waiter-${body.tableId}-${Date.now()}`,
          url: "/waiter",
        };
        try {
          const session = await useCases.sessions.findOpenSessionWaiter(body.tableId, restaurantId);
          if (session?.waiterId) sendPushToStaff(session.waiterId, payload).catch(() => {});
          else sendPushToRole("WAITER", restaurantId, payload).catch(() => {});
        } catch {
          sendPushToRole("WAITER", restaurantId, payload).catch(() => {});
        }
      } else {
        const payload = {
          title:
            body.type === "voice"
              ? "Voice Note"
              : body.command === "cash_payment"
                ? "Cash Collection"
                : "Message",
          body: body.text || "New message from manager",
          tag: `msg-${msg.id}`,
          url: "/waiter",
        };
        if (msg.to === "all") sendPushToRestaurant(restaurantId, payload).catch(() => {});
        else if (msg.to === "kitchen") sendPushToRole("KITCHEN", restaurantId, payload).catch(() => {});
        else sendPushToStaff(msg.to, payload).catch(() => {});
      }
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
