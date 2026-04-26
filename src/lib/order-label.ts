type OrderLike = {
  tableNumber?: number | null;
  vipGuestName?: string | null;
  orderType?: string;
};

export function getOrderLabel(order: OrderLike): string {
  if (order.orderType === "DELIVERY" && order.vipGuestName)
    return `Delivery: ${order.vipGuestName}`;
  if (order.orderType === "DELIVERY") return "Delivery";
  if (order.orderType === "VIP_DINE_IN" && order.vipGuestName)
    return `VIP: ${order.vipGuestName}`;
  if (order.orderType === "VIP_DINE_IN") return "VIP";
  if (order.tableNumber != null) return `Table ${order.tableNumber}`;
  return "Table";
}

export function getOrderTag(order: OrderLike): string {
  if (order.orderType === "DELIVERY") return "DEL";
  if (order.orderType === "VIP_DINE_IN") return "VIP";
  if (order.tableNumber != null) return `T${order.tableNumber}`;
  return "T?";
}
