// Style maps + utility helpers shared across every Floor Manager panel.
// Centralized so one palette change cascades through the whole feature.
// All class strings now speak the semantic design system (`sand-*`,
// `ocean-*`, `status-*` / `text-*-primary|secondary|muted`) — raw
// Tailwind hues (slate/indigo/emerald/amber/rose/red/violet/sky/blue)
// are forbidden here.

export const SESSION_DURATION = 16 * 60 * 60 * 1000;

export function minsAgo(ts: number): number {
  return Math.max(0, Math.round((Date.now() - ts) / 60000));
}

export function initials(name: string): string {
  return name
    .split(" ")
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

export const TABLE_COLORS: Record<string, { bg: string; border: string; label: string }> = {
  empty:        { bg: "bg-sand-100",         border: "border-sand-200",         label: "Idle" },
  seated:       { bg: "bg-status-info-50",   border: "border-status-info-200",  label: "Seated" },
  browsing:     { bg: "bg-status-info-50",   border: "border-status-info-300",  label: "Browsing" },
  ordered:      { bg: "bg-status-warn-50",   border: "border-status-warn-300",  label: "Ordered" },
  eating:       { bg: "bg-status-good-50",   border: "border-status-good-300",  label: "Served" },
  waiting_bill: { bg: "bg-status-wait-50",   border: "border-status-wait-200",  label: "Bill" },
  paying:       { bg: "bg-status-bad-50",    border: "border-status-bad-200",   label: "Paying" },
};

// Accent color on each table card's bottom strip — signal-only.
export const TABLE_ACCENT: Record<string, string> = {
  empty:        "bg-sand-300",
  seated:       "bg-status-info-400",
  browsing:     "bg-status-info-500",
  ordered:      "bg-status-warn-500",
  eating:       "bg-status-good-500",
  waiting_bill: "bg-status-wait-500",
  paying:       "bg-status-bad-500",
};

export const SEVERITY_STYLES: Record<string, { bg: string; border: string; icon: string; badge: string }> = {
  critical: { bg: "bg-status-bad-50",  border: "border-status-bad-200",  icon: "text-status-bad-600",  badge: "bg-status-bad-600" },
  warning:  { bg: "bg-status-warn-50", border: "border-status-warn-200", icon: "text-status-warn-600", badge: "bg-status-warn-500" },
  info:     { bg: "bg-status-info-50", border: "border-status-info-200", icon: "text-status-info-600", badge: "bg-status-info-500" },
};

export const ALERT_ICONS: Record<string, string> = {
  order_stuck: "!",
  order_ready_uncollected: "?",
  call_waiter_unanswered: "?",
  waiter_overloaded: "!",
  table_idle: "~",
  session_no_waiter: "?",
  kitchen_bottleneck: "!",
  payment_pending: "$",
  large_party: "+",
};

export const STATUS_COLORS: Record<string, { bg: string; text: string }> = {
  pending:   { bg: "bg-status-warn-100", text: "text-status-warn-700" },
  confirmed: { bg: "bg-status-info-100", text: "text-status-info-700" },
  preparing: { bg: "bg-status-wait-100", text: "text-status-wait-700" },
  ready:     { bg: "bg-status-good-100", text: "text-status-good-700" },
  served:    { bg: "bg-sand-100",        text: "text-text-secondary" },
  paid:      { bg: "bg-sand-100",        text: "text-text-muted" },
};

export const NEXT_STATUS: Record<string, { label: string; status: string }> = {
  pending: { label: "Confirm", status: "CONFIRMED" },
  confirmed: { label: "Start Prep", status: "PREPARING" },
  preparing: { label: "Mark Ready", status: "READY" },
  ready: { label: "Mark Served", status: "SERVED" },
};

// Palette used by the "waiter" view mode — each waiter gets one color.
export const WAITER_PALETTE = [
  "bg-status-info-100 border-status-info-300 text-status-info-700",
  "bg-status-good-100 border-status-good-300 text-status-good-700",
  "bg-status-wait-100 border-status-wait-300 text-status-wait-700",
  "bg-status-warn-100 border-status-warn-300 text-status-warn-700",
  "bg-status-bad-100 border-status-bad-300 text-status-bad-700",
  "bg-ocean-100 border-ocean-300 text-ocean-700",
];
