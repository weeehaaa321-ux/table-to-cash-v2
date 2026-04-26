import type { Order } from "@/domain/order/Order";
import type { OrderStatus } from "@/domain/order/enums";

export interface OrderRepository {
  findById(id: string): Promise<Order | null>;
  /**
   * Create with a clientRequestId for idempotency. If an order already
   * exists for this clientRequestId on the current restaurant, returns
   * the existing one without creating a duplicate.
   */
  createIdempotent(order: Order): Promise<Order>;
  updateStatus(id: string, status: OrderStatus, transitionedAt: Date): Promise<void>;
  /** All orders currently in PREPARING — used by floor-alerts cron. */
  listPreparing(): Promise<readonly Order[]>;
  /** All orders for a session, in chronological order. */
  listBySession(sessionId: string): Promise<readonly Order[]>;
}
