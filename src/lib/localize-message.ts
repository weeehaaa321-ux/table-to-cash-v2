// ─── Localize an in-app owner message ───────────────────
//
// Owner commands flow from the dashboard with English `text` so
// the DB has a stable record and analytics/audit trails read
// uniformly. The rendered text in /waiter, /kitchen, etc. should
// however match the staff member's chosen UI language.
//
// This helper pattern-matches on `command` (and uses the
// associated tableId / orderId for interpolation when present)
// to produce a localized body. Messages that don't match a
// known command fall through to the raw text — covers free-form
// owner input that we can't translate.

export type LocalizableMessage = {
  command?: string | null;
  type?: string | null;
  text?: string | null;
  tableId?: number | null;
  orderId?: string | null;
};

export function localizedMessageText(
  m: LocalizableMessage,
  lang: "en" | "ar",
): string {
  const t = m.tableId;
  const ar = lang === "ar";

  switch (m.command) {
    case "send_waiter":
      return ar
        ? `اذهب إلى الطاولة ${t ?? ""} — طلب من المالك`
        : `Go to Table ${t ?? ""} — owner request`;
    case "prioritize":
      return ar
        ? `أولوية — أسرع بهذا الطلب`
        : `Priority — rush this order`;
    case "push_menu":
      return ar
        ? `أرسل توصيات المنيو لطاولة ${t ?? ""}`
        : `Push menu recommendations to Table ${t ?? ""}`;
    case "call_waiter":
      return ar
        ? `طاولة ${t ?? ""} تطلب الجرسون`
        : `Table ${t ?? ""} is calling the waiter`;
    case "cash_payment":
      return ar
        ? `طلب تحصيل نقدي${m.text ? ` — ${m.text}` : ""}`
        : (m.text || `Cash collection requested`);
    default:
      // Voice notes: the title already says "Voice Note" via the
      // i18n key — body is the descriptive line. Localize the
      // generic case here, fall through to raw text otherwise.
      if (m.type === "voice") {
        return ar
          ? `ملاحظة صوتية من المدير`
          : (m.text || `Voice note from owner`);
      }
      return m.text || "";
  }
}
