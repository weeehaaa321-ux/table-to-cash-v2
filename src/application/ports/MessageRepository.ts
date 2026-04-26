import type { Message, MessageType, MessageCommand } from "@/domain/messaging/Message";

export type CreateMessageInput = {
  type: MessageType;
  from: string;
  to: string;
  text: string | null;
  audio: string | null;
  tableId: number | null;
  orderId: string | null;
  command: MessageCommand | null;
};

export interface MessageRepository {
  create(input: CreateMessageInput): Promise<Message>;
  listSince(sinceMs: number, toFilter: string | null): Promise<readonly Message[]>;
  resolveStaffNames(ids: readonly string[]): Promise<ReadonlyMap<string, string>>;
}
