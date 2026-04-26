"use client";

import { useEffect, useState } from "react";
import { getShiftCount, getShiftLabel } from "@/lib/shifts";

const SHIFT_BG = ["", "bg-status-info-100 text-status-info-700", "bg-status-warn-100 text-status-warn-700", "bg-status-good-100 text-status-good-700"];

export default function SchedulePopup({ staffId, role, onClose }: { staffId: string; role: string; onClose: () => void }) {
  const [schedules, setSchedules] = useState<{ date: string; shift: number }[]>([]);
  const [monthOffset, setMonthOffset] = useState(0);
  const slug = process.env.NEXT_PUBLIC_RESTAURANT_SLUG || "neom-dahab";

  const base = new Date();
  const viewDate = new Date(base.getFullYear(), base.getMonth() + monthOffset, 1);
  const year = viewDate.getFullYear();
  const m = viewDate.getMonth();

  useEffect(() => {
    fetch(`/api/schedule?restaurantId=${slug}&year=${year}&month=${m + 1}&staffId=${staffId}`)
      .then((r) => r.json())
      .then((data) => setSchedules(data.map((s: { date: string; shift: number }) => ({
        date: typeof s.date === "string" ? s.date.slice(0, 10) : new Date(s.date).toISOString().slice(0, 10),
        shift: s.shift,
      }))))
      .catch(() => {});
  }, [year, m, staffId, slug]);

  const daysInMonth = new Date(year, m + 1, 0).getDate();
  const firstDow = new Date(year, m, 1).getDay();
  const days = Array.from({ length: daysInMonth }, (_, i) => i + 1);
  const lookup = Object.fromEntries(schedules.map((s) => [s.date, s.shift]));
  const todayStr = new Date().toISOString().slice(0, 10);
  const monthLabel = viewDate.toLocaleString("en", { month: "long", year: "numeric" });
  const maxShifts = getShiftCount(role);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl p-5 w-[340px] max-h-[85vh] overflow-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <button onClick={() => setMonthOffset((p) => Math.max(p - 1, 0))} disabled={monthOffset === 0} className="p-1.5 hover:bg-sand-100 rounded-lg transition disabled:opacity-30">◀</button>
          <h3 className="text-sm font-semibold text-text-primary">{monthLabel}</h3>
          <button onClick={() => setMonthOffset((p) => Math.min(p + 1, 1))} disabled={monthOffset === 1} className="p-1.5 hover:bg-sand-100 rounded-lg transition disabled:opacity-30">▶</button>
        </div>
        <div className="grid grid-cols-7 gap-1 mb-1">
          {["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"].map((d) => (
            <div key={d} className="text-[9px] font-bold text-text-muted text-center">{d}</div>
          ))}
        </div>
        <div className="grid grid-cols-7 gap-1">
          {Array.from({ length: firstDow }).map((_, i) => <div key={`e${i}`} />)}
          {days.map((day) => {
            const dateStr = `${year}-${String(m + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
            const shift = lookup[dateStr];
            const isToday = dateStr === todayStr;
            return (
              <div key={day} className={`aspect-square flex flex-col items-center justify-center rounded-lg text-xs ${shift ? SHIFT_BG[shift] : "text-text-secondary"} ${isToday ? "ring-2 ring-status-info-400" : ""}`}>
                <span className="font-bold leading-none">{day}</span>
                {shift ? <span className="text-[7px] font-bold leading-none mt-0.5">S{shift}</span> : null}
              </div>
            );
          })}
        </div>
        <div className="flex gap-3 mt-4 justify-center flex-wrap">
          {Array.from({ length: maxShifts }, (_, i) => i + 1).map((s) => (
            <span key={s} className={`text-[8px] font-bold px-2 py-0.5 rounded ${SHIFT_BG[s]}`}>
              S{s}: {getShiftLabel(s, role).replace(/Shift \d /, "")}
            </span>
          ))}
        </div>
        <button onClick={onClose} className="mt-4 w-full py-2 rounded-xl bg-sand-100 text-text-secondary font-bold text-xs hover:bg-sand-200 transition">Close</button>
      </div>
    </div>
  );
}
