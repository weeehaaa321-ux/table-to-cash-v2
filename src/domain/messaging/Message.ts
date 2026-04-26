import type { Identifier } from "../shared/Identifier";

export type MessageId = Identifier<"Message">;

/**
 * Message — internal communication between owner/staff/staff-groups.
 * Source schema is intentionally loose to support 3 use cases:
 *   1. Voice/text command from owner ("send waiter to table 7")
 *   2. Alert ("kitchen at 90% — bottleneck risk")
 *   3. Free-text staff-to-staff
 *
 * Fields like `command`, `tableId`, `orderId` are optional context
 * carried per message type.
 */
export type MessageType = "alert" | "voice" | "command";
export type MessageCommand =
  | "send_waiter"
  | "prioritize"
  | "push_menu";

export class Message {
  private constructor(
    public readonly id: MessageId,
    public readonly type: MessageType,
    public readonly from: string, // "owner" | staffId
    public readonly to: string, // "all" | "kitchen" | staffId
    public readonly text: string | null,
    public readonly audio: string | null, // base64 data URL
    public readonly tableId: number | null,
    public readonly orderId: string | null,
    public readonly command: MessageCommand | null,
    public readonly createdAt: Date,
  ) {}

  static rehydrate(props: {
    id: MessageId;
    type: MessageType;
    from: string;
    to: string;
    text: string | null;
    audio: string | null;
    tableId: number | null;
    orderId: string | null;
    command: MessageCommand | null;
    createdAt: Date;
  }): Message {
    return new Message(
      props.id,
      props.type,
      props.from,
      props.to,
      props.text,
      props.audio,
      props.tableId,
      props.orderId,
      props.command,
      props.createdAt,
    );
  }
}
