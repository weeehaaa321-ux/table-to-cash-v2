import { nowInRestaurantTz } from "./restaurant-config";

// Role-specific shift schedules (restaurant local time)
// WAITER : 3 shifts × 8h — 00-08, 08-16, 16-00
// BAR    : 3 shifts × 8h — 00-08, 08-16, 16-00 (same as waiter)
// KITCHEN: 2 shifts × 8h — 08-16, 16-00 (no overnight shift)
// CASHIER: 2 shifts × 12h — 00-12, 12-00

// How many shift slots a given role has.
export function getShiftCount(role?: string): number {
  if (role === "CASHIER") return 2;
  if (role === "DELIVERY") return 2;
  return 3; // WAITER, BAR, KITCHEN, OWNER, FLOOR_MANAGER
}

// Get shift boundaries in minutes-of-day for a given role + shift number.
function getShiftBounds(shift: number, role?: string): { start: number; end: number } {
  if (role === "CASHIER") {
    return { start: (shift - 1) * 720, end: shift * 720 };
  }
  if (role === "DELIVERY") {
    return { start: (shift - 1) * 720, end: shift * 720 };
  }
  if (role === "KITCHEN") {
    return { start: (shift - 1) * 480, end: shift * 480 };
  }
  return { start: (shift - 1) * 480, end: shift * 480 };
}

export function getCurrentShift(): 1 | 2 | 3 {
  const cairoHour = getCairoHour();
  if (cairoHour < 8) return 1;
  if (cairoHour < 16) return 2;
  return 3;
}

export function getCairoHour(): number {
  const now = new Date();
  const cairoTime = nowInRestaurantTz(now);
  return cairoTime.getHours();
}

export function getShiftLabel(shift: number, role?: string): string {
  if (role === "CASHIER" || role === "DELIVERY") {
    switch (shift) {
      case 1: return "Shift 1 (12AM - 12PM)";
      case 2: return "Shift 2 (12PM - 12AM)";
      default: return "Unassigned";
    }
  }
  if (role === "KITCHEN") {
    switch (shift) {
      case 1: return "Shift 1 (12AM - 8AM)";
      case 2: return "Shift 2 (8AM - 4PM)";
      case 3: return "Shift 3 (4PM - 12AM)";
      default: return "Unassigned";
    }
  }
  // WAITER / BAR
  switch (shift) {
    case 1: return "Shift 1 (12AM - 8AM)";
    case 2: return "Shift 2 (8AM - 4PM)";
    case 3: return "Shift 3 (4PM - 12AM)";
    default: return "Unassigned";
  }
}

export function getShiftTimeRange(shift: number, role?: string): { start: string; end: string } {
  if (role === "CASHIER" || role === "DELIVERY") {
    switch (shift) {
      case 1: return { start: "00:00", end: "12:00" };
      case 2: return { start: "12:00", end: "00:00" };
      default: return { start: "--", end: "--" };
    }
  }
  if (role === "KITCHEN") {
    switch (shift) {
      case 1: return { start: "00:00", end: "08:00" };
      case 2: return { start: "08:00", end: "16:00" };
      case 3: return { start: "16:00", end: "00:00" };
      default: return { start: "--", end: "--" };
    }
  }
  switch (shift) {
    case 1: return { start: "00:00", end: "08:00" };
    case 2: return { start: "08:00", end: "16:00" };
    case 3: return { start: "16:00", end: "00:00" };
    default: return { start: "--", end: "--" };
  }
}

// Progress through the current 8-hour global grid (drives the dashboard
// banner). Stays tied to the waiter 3×8 grid so the "current shift"
// indicator is a consistent time-of-day readout.
export function getShiftProgress(): number {
  const cairoHour = getCairoHour();
  const cairoMinute = nowInRestaurantTz().getMinutes();
  const totalMinutes = cairoHour * 60 + cairoMinute;
  const shift = getCurrentShift();
  const shiftStartMinutes = (shift - 1) * 480;
  const elapsed = totalMinutes - shiftStartMinutes;
  return Math.min(100, Math.max(0, (elapsed / 480) * 100));
}

// Minutes until the staff's shift ends (positive = in shift, negative = before shift starts)
export function getShiftTimer(staffShift: number, role?: string): { isOnShift: boolean; minutesRemaining: number; label: string } {
  if (staffShift === 0) return { isOnShift: true, minutesRemaining: 0, label: "No shift assigned" };

  const cairoNow = nowInRestaurantTz();
  const cairoMinutes = cairoNow.getHours() * 60 + cairoNow.getMinutes();

  const { start: shiftStartMin, end: shiftEndMin } = getShiftBounds(staffShift, role);

  if (cairoMinutes >= shiftStartMin && cairoMinutes < shiftEndMin) {
    const remaining = shiftEndMin - cairoMinutes;
    const h = Math.floor(remaining / 60);
    const m = remaining % 60;
    return {
      isOnShift: true,
      minutesRemaining: remaining,
      label: `${h}h ${m}m remaining`,
    };
  }

  // 30-min grace after shift ends for KITCHEN/BAR — matches canLoginNow
  if (role === "KITCHEN" || role === "BAR") {
    const sinceEnd = cairoMinutes - shiftEndMin;
    const sinceEndWrapped = sinceEnd < 0 ? sinceEnd + 1440 : sinceEnd;
    if (sinceEndWrapped >= 0 && sinceEndWrapped <= 30) {
      const graceLeft = 30 - sinceEndWrapped;
      return {
        isOnShift: true,
        minutesRemaining: graceLeft,
        label: `${graceLeft}m overtime`,
      };
    }
  }

  let untilStart = shiftStartMin - cairoMinutes;
  if (untilStart < 0) untilStart += 1440;

  const h = Math.floor(untilStart / 60);
  const m = untilStart % 60;
  return {
    isOnShift: false,
    minutesRemaining: -untilStart,
    label: `Shift starts in ${h}h ${m}m`,
  };
}

// Is a station (KITCHEN/BAR) accepting new orders right now?
// Returns false if: no staff on any shift, currently outside coverage,
// or within 30 min of the last shift ending before a gap.
export function isStationAcceptingOrders(
  role: "KITCHEN" | "BAR",
  staffShifts: number[]
): boolean {
  const assigned = staffShifts.filter((s) => s !== 0);
  if (assigned.length === 0) return false;

  const unique = [...new Set(assigned)];
  const shiftCount = getShiftCount(role);
  if (unique.length === shiftCount) return true;

  const cairoNow = nowInRestaurantTz();
  const cairoMin = cairoNow.getHours() * 60 + cairoNow.getMinutes();

  const intervals = unique
    .map((s) => getShiftBounds(s, role))
    .sort((a, b) => a.start - b.start);

  const merged: { start: number; end: number }[] = [];
  for (const iv of intervals) {
    const last = merged[merged.length - 1];
    if (last && last.end >= iv.start) {
      last.end = Math.max(last.end, iv.end);
    } else {
      merged.push({ start: iv.start, end: iv.end });
    }
  }

  if (
    merged.length >= 2 &&
    merged[merged.length - 1].end >= 1440 &&
    merged[0].start === 0
  ) {
    merged[0].start = merged[merged.length - 1].start;
    merged.pop();
  }

  for (const block of merged) {
    if (block.start <= block.end) {
      if (cairoMin >= block.start && cairoMin < block.end) {
        return block.end - cairoMin > 30;
      }
    } else {
      if (cairoMin >= block.start || cairoMin < block.end) {
        const until =
          cairoMin >= block.start
            ? 1440 - cairoMin + block.end
            : block.end - cairoMin;
        return until > 30;
      }
    }
  }

  return false;
}

// Check if a staff member can log in now based on their shift and role.
// Waiters/Cashiers: 15 min early window. Kitchen/Bar: 1 hour early window.
export function canLoginNow(staffShift: number, role: string): { allowed: boolean; reason: string } {
  if (staffShift === 0) return { allowed: true, reason: "" };

  const cairoNow = nowInRestaurantTz();
  const cairoMinutes = cairoNow.getHours() * 60 + cairoNow.getMinutes();

  const { start: shiftStartMin, end: shiftEndMin } = getShiftBounds(staffShift, role);

  if (cairoMinutes >= shiftStartMin && cairoMinutes < shiftEndMin) {
    return { allowed: true, reason: "" };
  }

  // Grace window AFTER shift end — kitchen/bar get 30 min to re-login
  // for cleanup (finishing last tickets, marking orders ready). Waiters
  // hand off via end-shift so they don't need it.
  if (role === "KITCHEN" || role === "BAR") {
    // shiftEndMin of 1440 (midnight) wraps to 0, but we compare raw minutes here
    const sinceEnd = cairoMinutes - shiftEndMin;
    const sinceEndWrapped = sinceEnd < 0 ? sinceEnd + 1440 : sinceEnd;
    if (sinceEndWrapped >= 0 && sinceEndWrapped <= 30) {
      return { allowed: true, reason: "" };
    }
  }

  let untilStart = shiftStartMin - cairoMinutes;
  if (untilStart < 0) untilStart += 1440;

  const earlyMinutes = role === "KITCHEN" || role === "BAR" ? 60 : 15;

  if (untilStart <= earlyMinutes) {
    return { allowed: true, reason: "" };
  }

  const h = Math.floor(untilStart / 60);
  const m = untilStart % 60;
  const earlyLabel = role === "KITCHEN" || role === "BAR" ? "1 hour" : "15 minutes";
  return {
    allowed: false,
    reason: `Your shift starts in ${h}h ${m}m. You can log in ${earlyLabel} before your shift.`,
  };
}
