import type { MessageRepository, CreateMessageInput } from "../ports/MessageRepository";
import type { Message } from "@/domain/messaging/Message";

export class SendMessageUseCase {
  constructor(private readonly repo: MessageRepository) {}
  async execute(input: CreateMessageInput): Promise<Message> {
    return this.repo.create(input);
  }
}

export class PollMessagesUseCase {
  constructor(private readonly repo: MessageRepository) {}
  async execute(sinceMs: number, toFilter: string | null): Promise<{
    messages: readonly Message[];
    namesByStaffId: ReadonlyMap<string, string>;
  }> {
    const messages = await this.repo.listSince(sinceMs, toFilter);
    const ids = Array.from(new Set(messages.flatMap((m) => [m.from, m.to])));
    const names = await this.repo.resolveStaffNames(ids);
    return { messages, namesByStaffId: names };
  }
}
