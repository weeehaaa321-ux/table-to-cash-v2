import { db } from "../client";
import { env } from "../../config/env";
import type { MessageRepository, CreateMessageInput } from "@/application/ports/MessageRepository";
import { Message } from "@/domain/messaging/Message";
import type { MessageType, MessageCommand } from "@/domain/messaging/Message";
import { makeId } from "@/domain/shared/Identifier";

let cachedRestaurantId: string | null = null;
async function getRestaurantId(): Promise<string> {
  if (cachedRestaurantId) return cachedRestaurantId;
  const r = await db.restaurant.findUnique({
    where: { slug: env.RESTAURANT_SLUG },
    select: { id: true },
  });
  if (!r) throw new Error(`No Restaurant slug=${env.RESTAURANT_SLUG}`);
  cachedRestaurantId = r.id;
  return r.id;
}

function mapMessage(row: {
  id: string; type: string; from: string; to: string;
  text: string | null; audio: string | null;
  tableId: number | null; orderId: string | null; command: string | null;
  createdAt: Date;
}): Message {
  return Message.rehydrate({
    id: makeId<"Message">(row.id),
    type: row.type as MessageType,
    from: row.from,
    to: row.to,
    text: row.text,
    audio: row.audio,
    tableId: row.tableId,
    orderId: row.orderId,
    command: row.command as MessageCommand | null,
    createdAt: row.createdAt,
  });
}

export class PrismaMessageRepository implements MessageRepository {
  async create(input: CreateMessageInput): Promise<Message> {
    const restaurantId = await getRestaurantId();
    const row = await db.message.create({
      data: { ...input, restaurantId },
    });
    return mapMessage(row);
  }

  async listSince(sinceMs: number, toFilter: string | null): Promise<readonly Message[]> {
    const restaurantId = await getRestaurantId();
    const rows = await db.message.findMany({
      where: {
        createdAt: { gt: new Date(sinceMs) },
        restaurantId,
        ...(toFilter ? { to: { in: ["all", toFilter] } } : {}),
      },
      orderBy: { createdAt: "asc" },
      take: 50,
    });
    return rows.map(mapMessage);
  }

  async resolveStaffNames(ids: readonly string[]): Promise<ReadonlyMap<string, string>> {
    const cuids = ids.filter((v) => v.startsWith("c") && v.length > 10);
    if (cuids.length === 0) return new Map();
    const rows = await db.staff.findMany({
      where: { id: { in: cuids } },
      select: { id: true, name: true },
    });
    return new Map(rows.map((s) => [s.id, s.name]));
  }
}
