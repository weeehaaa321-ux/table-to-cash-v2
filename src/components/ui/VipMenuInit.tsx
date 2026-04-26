"use client";

import { useEffect } from "react";
import { useCart } from "@/store/cart";

export function VipMenuInit({
  vipGuestId,
  vipName,
  orderType,
  sessionId,
}: {
  vipGuestId?: string;
  vipName?: string;
  orderType?: string;
  sessionId?: string;
}) {
  useEffect(() => {
    const cart = useCart.getState();
    if (vipGuestId && vipName) {
      cart.setVipGuest(vipGuestId, decodeURIComponent(vipName));
    }
    if (orderType === "VIP_DINE_IN" || orderType === "DELIVERY") {
      cart.setOrderType(orderType);
    }
    if (sessionId) {
      cart.setSessionId(sessionId);
    }
    if (orderType === "DELIVERY" && typeof window !== "undefined") {
      try {
        const storedGuestId = localStorage.getItem("ttc_vip_guestId") || "";
        if (storedGuestId === vipGuestId) {
          const addr = localStorage.getItem("ttc_vip_deliveryAddress") || "";
          const notes = localStorage.getItem("ttc_vip_deliveryNotes") || "";
          const lat = localStorage.getItem("ttc_vip_deliveryLat");
          const lng = localStorage.getItem("ttc_vip_deliveryLng");
          cart.setDeliveryInfo(addr, notes, lat ? parseFloat(lat) : null, lng ? parseFloat(lng) : null);
        }
      } catch {}
    }
  }, [vipGuestId, vipName, orderType, sessionId]);

  return null;
}
