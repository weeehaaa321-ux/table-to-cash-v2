"use client";

import { useState } from "react";
import { useLanguage } from "@/lib/use-language";
import type { DeliveryOrder, StaffInfo } from "./types";

export function DeliveryCard({
  delivery, drivers, onAssign, onUpdateStatus,
}: {
  delivery: DeliveryOrder;
  drivers: StaffInfo[];
  onAssign: (orderId: string, driverId: string) => void;
  onUpdateStatus: (orderId: string, status: string) => void;
}) {
  const [showDrivers, setShowDrivers] = useState(false);
  const { t } = useLanguage();
  const isUnassigned = !delivery.deliveryDriverId;
  const statusLabel: Record<string, { label: string; color: string }> = {
    ASSIGNED: { label: t("floor.assigned"), color: "bg-status-info-100 text-status-info-700" },
    PICKED_UP: { label: t("floor.pickedUp"), color: "bg-status-warn-100 text-status-warn-700" },
    ON_THE_WAY: { label: t("floor.onTheWay"), color: "bg-status-wait-100 text-status-wait-700" },
    DELIVERED: { label: t("floor.delivered"), color: "bg-status-good-100 text-status-good-700" },
  };
  const ds = delivery.deliveryStatus ? statusLabel[delivery.deliveryStatus] : null;
  const nextDeliveryAction: Record<string, { label: string; status: string }> = {
    ASSIGNED: { label: t("floor.markPickedUp"), status: "PICKED_UP" },
    PICKED_UP: { label: t("floor.markOnTheWay"), status: "ON_THE_WAY" },
    ON_THE_WAY: { label: t("floor.markDelivered"), status: "DELIVERED" },
  };
  const nextAction = delivery.deliveryStatus ? nextDeliveryAction[delivery.deliveryStatus] : null;

  return (
    <div className={`rounded-xl p-3 border ${isUnassigned ? "bg-status-bad-50 border-status-bad-200" : "bg-white border-sand-200"}`}>
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-text-primary">#{delivery.orderNumber}</span>
          {ds && <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${ds.color}`}>{ds.label}</span>}
        </div>
        <span className="text-xs font-bold text-status-good-600">{delivery.total} EGP</span>
      </div>
      <p className="text-xs font-bold text-text-secondary">{delivery.vipGuestName || "VIP"}</p>
      {delivery.deliveryAddress && <p className="text-[10px] text-text-secondary truncate">{delivery.deliveryAddress}</p>}
      <p className="text-[10px] text-text-muted mt-0.5">
        {delivery.items.map((i) => `${i.quantity > 1 ? `${i.quantity}x ` : ""}${i.name}`).join(", ")}
      </p>
      {delivery.deliveryDriverName && <p className="text-[10px] text-ocean-600 font-bold mt-1">{t("floor.driver")}: {delivery.deliveryDriverName}</p>}

      <div className="flex gap-2 mt-2">
        {isUnassigned && (
          <button onClick={() => setShowDrivers(!showDrivers)}
            className="flex-1 py-2 rounded-lg bg-ocean-600 text-white text-[10px] font-bold active:scale-95 transition">
            {t("floor.assignDriver")}
          </button>
        )}
        {nextAction && (
          <button onClick={() => onUpdateStatus(delivery.id, nextAction.status)}
            className="flex-1 py-2 rounded-lg bg-status-good-600 text-white text-[10px] font-bold active:scale-95 transition">
            {nextAction.label}
          </button>
        )}
      </div>

      {showDrivers && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {drivers.length === 0 ? (
            <span className="text-[10px] text-text-muted">{t("floor.noDriversAvailable")}</span>
          ) : drivers.map((d) => (
            <button key={d.id} onClick={() => { onAssign(delivery.id, d.id); setShowDrivers(false); }}
              className="px-2.5 py-1.5 rounded-lg bg-white border border-sand-200 text-[10px] font-bold text-text-secondary active:scale-95 transition">
              {d.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
