"use client";

import { useMemo, useState } from "react";

// ═══════════════════════════════════════════════════════
// OWNER MANUAL — searchable index of every action the
// owner can take, with the exact button path. The goal is:
// owner types "pin" → sees "Reset someone's PIN" → clicks
// "Go" and the dashboard switches to the Staff tab so they
// can execute immediately, with the step list still visible.
// ═══════════════════════════════════════════════════════

export type ManualNavTab =
  | "overview" | "staff" | "menu" | "analytics"
  | "controls" | "vip" | "books";

type Topic =
  | "Money"
  | "Menu"
  | "Staff"
  | "Schedule"
  | "Floor"
  | "VIP"
  | "Cashier app"
  | "Waiter app"
  | "Troubleshooting";

type Task = {
  id: string;
  title: string;
  topic: Topic;
  when: string;
  /** Which dashboard tab to jump to. Null when the task lives outside the dashboard (cashier / waiter phone). */
  tab: ManualNavTab | null;
  /** Where the action actually happens when tab is null. */
  location?: string;
  steps: string[];
  /** Extra search terms. */
  keywords?: string[];
};

const TASKS: Task[] = [
  // ─── Money ────────────────────────────────────────
  {
    id: "close-day",
    title: "Close the books for a day",
    topic: "Money",
    when: "End of the business day, once cash has been counted and nothing else will be paid. Locks the day's numbers so later edits can't silently rewrite history.",
    tab: "books",
    steps: [
      "Open the Books tab.",
      "Under Daily Close, pick the date (Today button fills in today's Cairo date).",
      "Click Close <date>. Confirm the prompt.",
      "The closed day appears in the list below with frozen totals (revenue, orders, cash, card, comped, cancelled).",
    ],
    keywords: ["eod", "end of day", "lock", "snapshot", "daily close"],
  },
  {
    id: "export-csv",
    title: "Export orders to CSV (for accountant)",
    topic: "Money",
    when: "Monthly or whenever accounting needs a spreadsheet of every order with totals, payment method, and timestamps.",
    tab: "books",
    steps: [
      "Open the Books tab.",
      "Under Export Orders (CSV), set From and To dates.",
      "Click Export. The browser downloads a .csv file ready for Excel.",
    ],
    keywords: ["download", "spreadsheet", "accountant", "excel", "report"],
  },
  {
    id: "todays-revenue",
    title: "See today's revenue + tips",
    topic: "Money",
    when: "Any time you want a live number — updates every few seconds.",
    tab: "overview",
    steps: [
      "Open the Overview tab (default).",
      "Top row shows Revenue, Orders, Tips, Wait Time — all in Cairo time, resets at midnight.",
    ],
    keywords: ["dashboard", "kpi", "live", "tips", "revenue"],
  },
  {
    id: "waiter-performance",
    title: "See which waiter is selling the most",
    topic: "Money",
    when: "Weekly review, shift-change decisions, promotion or performance talk.",
    tab: "analytics",
    steps: [
      "Open the Analytics tab.",
      "Pick the period (Today / Week / Month / custom).",
      "The 'Per-waiter' section lists each waiter with their orders, revenue, and average order value.",
    ],
    keywords: ["staff performance", "server", "sales", "leaderboard", "ranking"],
  },

  // ─── Menu ─────────────────────────────────────────
  {
    id: "add-menu-item",
    title: "Add a new menu item",
    topic: "Menu",
    when: "New dish, new drink, or anything that should appear on the guest menu.",
    tab: "menu",
    steps: [
      "Open the Menu tab.",
      "On the left, click the category this item belongs to (e.g. Mains, Drinks).",
      "Scroll to the bottom, click + Add Item to <category>.",
      "Fill Name, Price, and optionally Arabic/Russian name, description, image, prep time.",
      "Click Create. The item is live for guests immediately if Available is on.",
    ],
    keywords: ["create dish", "new item", "drink", "food"],
  },
  {
    id: "mark-unavailable",
    title: "86 an item (mark out of stock)",
    topic: "Menu",
    when: "Kitchen ran out; guest menu should hide it until it's back.",
    tab: "menu",
    steps: [
      "Open the Menu tab.",
      "Find the item in its category.",
      "Click Available on its row to toggle it to Unavailable.",
      "The guest menu hides it within seconds. Toggle back to Available when restocked.",
    ],
    keywords: ["86", "sold out", "out of stock", "hide item", "unavailable"],
  },
  {
    id: "change-price",
    title: "Change a menu item's price",
    topic: "Menu",
    when: "Supplier cost changed, promotional price, permanent update.",
    tab: "menu",
    steps: [
      "Open the Menu tab.",
      "Find the item, click it to expand the edit form.",
      "Change the Price field.",
      "Click Save. New price applies to new orders only — already-placed orders keep their recorded price.",
    ],
    keywords: ["edit price", "cost", "update price"],
  },
  {
    id: "set-breakfast-hours",
    title: "Make an item available only during specific hours (e.g. breakfast)",
    topic: "Menu",
    when: "Breakfast items that shouldn't show at dinner, happy-hour drinks, lunch-only specials.",
    tab: "menu",
    steps: [
      "Open the Menu tab.",
      "Find the item, click it to edit.",
      "Set Available from hour to 6 and Available to hour to 12 (24-hour Cairo time) for a 6:00–12:00 window.",
      "Click Save. The guest menu will hide the item outside that window automatically.",
      "Heads up: right now this has to be set on each item individually. If that's painful, tell Claude and we'll build a category-level hours setting.",
    ],
    keywords: ["breakfast", "time window", "hours", "schedule menu", "hide after"],
  },

  // ─── Staff ────────────────────────────────────────
  {
    id: "add-staff",
    title: "Add a new staff member",
    topic: "Staff",
    when: "New hire. They need a PIN to log into the waiter/cashier/owner app.",
    tab: "staff",
    steps: [
      "Open the Staff tab.",
      "Click + New Staff.",
      "Enter Name, pick Role (Waiter / Cashier / Owner / Delivery), set a 4–6 digit PIN (or click Generate).",
      "Pick Shift if they're assigned to one (0 = all shifts).",
      "Click Create. Give them the PIN in person — it's only shown once.",
    ],
    keywords: ["hire", "new employee", "waiter", "cashier"],
  },
  {
    id: "reset-pin",
    title: "Reset someone's PIN",
    topic: "Staff",
    when: "Staff forgot their PIN, or you suspect it's been shared.",
    tab: "staff",
    steps: [
      "Open the Staff tab.",
      "Find the staff member's row.",
      "Click Reset PIN.",
      "Either type a new PIN or click Generate for a random one.",
      "Click Save. Share the new PIN with them in person.",
    ],
    keywords: ["forgot pin", "password", "reset password", "login"],
  },
  {
    id: "deactivate-staff",
    title: "Deactivate a staff member (they left)",
    topic: "Staff",
    when: "Staff quit or was let go. Keeps their past orders in history but blocks login.",
    tab: "staff",
    steps: [
      "Open the Staff tab.",
      "Find their row.",
      "Toggle Active off (or click the red deactivate icon, depending on UI).",
      "They can no longer log in. Their historical orders stay attached to their name for reporting.",
    ],
    keywords: ["quit", "fired", "remove staff", "disable login"],
  },

  // ─── Schedule ─────────────────────────────────────
  {
    id: "weekly-schedule",
    title: "Build the weekly shift schedule",
    topic: "Schedule",
    when: "Every Sunday (or whenever you plan shifts for the next 7 days).",
    tab: "staff",
    steps: [
      "Open the Staff tab. Scroll to the Schedule section.",
      "Pick the week.",
      "Click a cell (staff × day) to set which shift they work that day: 1 = 00:00–08:00, 2 = 08:00–16:00, 3 = 16:00–00:00, 0 = off.",
      "Changes save automatically. The waiter app picks them up on their next login.",
    ],
    keywords: ["roster", "shifts", "weekly", "calendar"],
  },
  {
    id: "fill-month",
    title: "Copy a shift pattern for the whole month",
    topic: "Schedule",
    when: "One staff member has the same shift every working day and you don't want to click 30 cells.",
    tab: "staff",
    steps: [
      "Open the Staff tab. Scroll to the Schedule section.",
      "Set the shift for the first occurrence.",
      "Click Fill entire month on that row. Every future day in the month gets the same shift.",
    ],
    keywords: ["bulk schedule", "copy schedule", "month", "repeat"],
  },

  // ─── Floor ────────────────────────────────────────
  {
    id: "see-live-floor",
    title: "See which tables are occupied right now",
    topic: "Floor",
    when: "Any time. Tables are colour-coded by state (empty, seated, ordered, waiting bill, paying).",
    tab: "controls",
    steps: [
      "Open the Controls tab. The floor layout is at the top of the page.",
      "Click a table to see its current session, who's seated, what they've ordered, and how long they've been there.",
    ],
    keywords: ["live map", "tables", "occupancy", "floor plan"],
  },

  // ─── VIP ──────────────────────────────────────────
  {
    id: "create-vip",
    title: "Create a VIP guest (room service / regular)",
    topic: "VIP",
    when: "Resort guest ordering to their room, or a regular who wants a tab under their name.",
    tab: "vip",
    steps: [
      "Open the VIP tab.",
      "Click Create VIP.",
      "Enter name, room number / identifier, any notes.",
      "Click Create VIP. Waiters can now open sessions under this guest's name instead of a table.",
    ],
    keywords: ["room service", "resort", "regular customer", "account", "tab"],
  },

  // ─── Cashier app (external) ───────────────────────
  {
    id: "take-payment",
    title: "Take a payment (cashier)",
    topic: "Cashier app",
    tab: null,
    location: "Cashier app → /cashier on the cashier's phone or PC",
    when: "Guest is ready to pay. They may have pre-tapped a method on their phone, or walked up.",
    steps: [
      "The session appears in the Accept Payment panel with its unpaid total.",
      "Pick method: Cash / Card / Instapay (or use whatever the guest chose if they pre-tapped).",
      "In the confirm modal, optionally enter a Tip amount.",
      "Click Confirm Received. Receipt prints (if the print agent is running) and the session closes or rolls to a new round.",
    ],
    keywords: ["pay", "settle", "confirm", "cash", "card", "receipt"],
  },
  {
    id: "enter-tip",
    title: "Record a tip at payment time",
    topic: "Cashier app",
    tab: null,
    location: "Cashier app",
    when: "Guest hands over cash that includes a tip, or adds a tip on the card.",
    steps: [
      "Open the Accept Payment panel and pick a method like normal.",
      "In the confirm modal, type the tip amount (EGP) in the Tip field before confirming.",
      "Click Confirm Received. The tip is stored on the first order of that payment round and appears on the Owner Overview 'Tips' tile.",
    ],
    keywords: ["gratuity", "tip", "service charge"],
  },
  {
    id: "reverse-payment",
    title: "Reverse a cashier's mistaken payment",
    topic: "Cashier app",
    tab: null,
    location: "Cashier app",
    when: "Cashier confirmed the wrong session / wrong method within the last few minutes.",
    steps: [
      "In the cashier app, find the session in Recent Payments (the emerald panel on the right).",
      "Click Reverse on that row. Enter a reason (required).",
      "Confirm. The orders go back to unpaid; drawer expected total adjusts.",
    ],
    keywords: ["undo payment", "mistake", "wrong table", "refund"],
  },
  {
    id: "open-drawer",
    title: "Open the cash drawer at start of shift",
    topic: "Cashier app",
    tab: null,
    location: "Cashier app — left column, top panel",
    when: "Start of your cashier shift, once you've counted the physical float in the till.",
    steps: [
      "Open /cashier and log in.",
      "Top-left panel says 'Cash drawer · closed'.",
      "Type the opening float (EGP you counted into the till).",
      "Click Open. Panel turns green and starts tracking expected cash live.",
    ],
    keywords: ["drawer", "float", "till", "opening", "start shift"],
  },
  {
    id: "close-drawer",
    title: "Close the cash drawer at end of shift",
    topic: "Cashier app",
    tab: null,
    location: "Cashier app",
    when: "End of your cashier shift, before handing the till to the next cashier or owner.",
    steps: [
      "Count the physical cash in the till.",
      "In the Cash drawer panel, type that amount into Physical count.",
      "Optionally type a note (e.g. 'gave 50 EGP change back').",
      "Click Close drawer. A receipt shows Expected vs Counted vs Variance. Green = match, amber = over, red = short.",
    ],
    keywords: ["drawer", "close", "variance", "end shift", "count out"],
  },
  {
    id: "print-receipt",
    title: "Reprint a receipt",
    topic: "Cashier app",
    tab: null,
    location: "Cashier app — Print Receipts panel",
    when: "Guest asked for another copy, or the first print failed.",
    steps: [
      "The Print Receipts panel (emerald) lists recently closed sessions.",
      "Click the Print button on that row.",
      "If the print agent is running on the cashier PC, it prints silently to the Xprinter. Otherwise a browser print dialog opens.",
    ],
    keywords: ["reprint", "duplicate receipt", "invoice", "paper"],
  },

  // ─── Waiter app (external) ────────────────────────
  {
    id: "comp-item",
    title: "Comp (give free of charge) an item",
    topic: "Waiter app",
    tab: null,
    location: "Waiter/Floor app — /floor on the waiter's phone",
    when: "Guest complaint, manager gesture, mistake. Item appears on the bill at 0 EGP with FREE tag.",
    steps: [
      "On the floor page, tap the table's current order.",
      "On the item row, open actions and choose Comp.",
      "Enter a reason (required — shows up in comp report).",
      "Save. Item price becomes 0, bill recomputes, comp is logged for nightly reporting.",
    ],
    keywords: ["free", "gift", "complimentary", "discount"],
  },
  {
    id: "cancel-order",
    title: "Cancel an order or item",
    topic: "Waiter app",
    tab: null,
    location: "Waiter app",
    when: "Guest changed their mind before the kitchen started, or kitchen can't make it.",
    steps: [
      "Open the order on the floor page.",
      "Cancel the whole order, or cancel a single item with a reason.",
      "Cancelled items don't count toward revenue or the drawer expected total.",
    ],
    keywords: ["void", "refund", "undo order"],
  },

  // ─── Troubleshooting ──────────────────────────────
  {
    id: "payment-wrong-table",
    title: "Payment was taken on the wrong table",
    topic: "Troubleshooting",
    tab: null,
    location: "Cashier app",
    when: "Cashier confirmed payment on Table 5 but the money was from Table 7.",
    steps: [
      "In the cashier app, find Table 5's session in Recent Payments.",
      "Click Reverse, enter reason 'wrong table'. Table 5 goes back to unpaid.",
      "Now find Table 7's session and take the payment as normal.",
    ],
    keywords: ["mistake", "wrong table", "fix payment"],
  },
  {
    id: "drawer-short",
    title: "Drawer came up short (variance < 0)",
    topic: "Troubleshooting",
    tab: null,
    location: "Cashier app + Books",
    when: "Cash drawer close showed the till had less than expected.",
    steps: [
      "Check Recent Payments for a cash order you might have rung up but whose money you paid out as change by mistake.",
      "Ask the cashier if any cash order got comped after they took the cash.",
      "Check for a reversed payment — the drawer expected total drops when you reverse.",
      "If none of the above, document the variance in the close note. One-off small shorts are expected; a pattern is a coaching moment.",
    ],
    keywords: ["variance", "short", "missing cash", "drawer short"],
  },
  {
    id: "lost-phone",
    title: "Staff lost their phone with an open session",
    topic: "Troubleshooting",
    tab: "staff",
    when: "Security concern — whoever has the phone could log into the waiter app.",
    steps: [
      "Open the Staff tab.",
      "Find the person's row. Click Reset PIN and set a new one.",
      "Their old device is now locked out. Give them the new PIN once they get a replacement phone.",
    ],
    keywords: ["security", "lost device", "stolen", "emergency"],
  },
];

const TOPICS: Topic[] = [
  "Money", "Menu", "Staff", "Schedule", "Floor", "VIP", "Cashier app", "Waiter app", "Troubleshooting",
];

export function OwnerManual({ onJumpToTab }: { onJumpToTab: (tab: ManualNavTab) => void }) {
  const [query, setQuery] = useState("");
  const [topic, setTopic] = useState<Topic | "All">("All");
  const [openId, setOpenId] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return TASKS.filter((t) => {
      if (topic !== "All" && t.topic !== topic) return false;
      if (!q) return true;
      const hay = [t.title, t.when, t.topic, ...(t.keywords || []), ...t.steps].join(" ").toLowerCase();
      return hay.includes(q);
    });
  }, [query, topic]);

  return (
    <div className="space-y-4">
      {/* Header + search */}
      <div className="bg-white rounded-2xl border border-sand-200 p-5 shadow-sm">
        <div className="flex items-start justify-between gap-4 mb-3">
          <div>
            <h2 className="text-text-primary font-semibold text-xl">Owner Manual</h2>
            <p className="text-text-muted text-sm">
              Search any action you want to take. Click a task for the exact sequence of buttons — then use
              <b className="text-text-primary"> Go there</b> to jump to that tab.
            </p>
          </div>
          <span className="text-[11px] font-bold text-text-muted px-2.5 py-1 rounded-lg bg-sand-100 border border-sand-200 shrink-0">
            {filtered.length} / {TASKS.length} tasks
          </span>
        </div>
        <input
          autoFocus
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Try: pin, comp, breakfast, drawer, export..."
          className="w-full px-4 py-3 rounded-xl border-2 border-sand-200 text-sm font-semibold focus:border-ocean-400 focus:outline-none"
        />
        <div className="flex flex-wrap gap-1.5 mt-3">
          {(["All", ...TOPICS] as const).map((t) => {
            const active = topic === t;
            return (
              <button
                key={t}
                onClick={() => setTopic(t as Topic | "All")}
                className={`px-3 py-1.5 rounded-lg text-[11px] font-bold uppercase tracking-wider border transition ${
                  active
                    ? "bg-ocean-600 text-white border-ocean-600 shadow-sm"
                    : "bg-sand-50 text-text-secondary border-sand-200 hover:bg-sand-100"
                }`}
              >
                {t}
              </button>
            );
          })}
        </div>
      </div>

      {/* Task list */}
      {filtered.length === 0 ? (
        <div className="bg-white rounded-2xl border border-sand-200 p-8 text-center">
          <p className="text-text-muted text-sm">
            No task matches <b>&ldquo;{query}&rdquo;</b>.
          </p>
          <p className="text-text-muted text-xs mt-2">
            Try a single word like <i>pin</i>, <i>tip</i>, <i>refund</i>, or clear the search.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((t) => {
            const open = openId === t.id;
            return (
              <div
                key={t.id}
                className={`bg-white rounded-2xl border ${open ? "border-ocean-300 shadow-sm" : "border-sand-200"} overflow-hidden transition`}
              >
                <button
                  onClick={() => setOpenId(open ? null : t.id)}
                  className="w-full px-5 py-4 flex items-start justify-between gap-3 text-left hover:bg-sand-50"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-[10px] font-semibold uppercase tracking-wider text-ocean-600 bg-ocean-50 px-2 py-0.5 rounded border border-ocean-200">
                        {t.topic}
                      </span>
                      {t.tab === null && (
                        <span className="text-[10px] font-semibold uppercase tracking-wider text-status-warn-700 bg-status-warn-50 px-2 py-0.5 rounded border border-status-warn-200">
                          Outside dashboard
                        </span>
                      )}
                    </div>
                    <h3 className="text-text-primary font-bold text-[15px] leading-snug">{t.title}</h3>
                    {!open && <p className="text-text-muted text-xs mt-1 line-clamp-1">{t.when}</p>}
                  </div>
                  <span className={`text-ocean-500 text-lg shrink-0 transition-transform ${open ? "rotate-90" : ""}`}>›</span>
                </button>

                {open && (
                  <div className="px-5 pb-5 border-t border-sand-100 pt-4 space-y-4">
                    <div>
                      <p className="text-[10px] font-semibold uppercase tracking-wider text-text-muted mb-1">When to use</p>
                      <p className="text-sm text-text-secondary">{t.when}</p>
                    </div>

                    <div>
                      <p className="text-[10px] font-semibold uppercase tracking-wider text-text-muted mb-2">Steps</p>
                      <ol className="space-y-2">
                        {t.steps.map((step, i) => (
                          <li key={i} className="flex gap-3 items-start">
                            <span className="w-6 h-6 rounded-full bg-ocean-100 border border-ocean-200 text-ocean-700 text-[11px] font-semibold flex items-center justify-center shrink-0">
                              {i + 1}
                            </span>
                            <span className="text-sm text-text-primary leading-relaxed">{step}</span>
                          </li>
                        ))}
                      </ol>
                    </div>

                    <div className="flex flex-wrap items-center gap-2 pt-2">
                      {t.tab ? (
                        <button
                          onClick={() => onJumpToTab(t.tab!)}
                          className="px-4 py-2 rounded-xl bg-ocean-600 text-white text-sm font-bold active:scale-95 hover:bg-ocean-700"
                        >
                          Go to {labelForTab(t.tab)} →
                        </button>
                      ) : (
                        <span className="px-3 py-2 rounded-xl bg-status-warn-50 border border-status-warn-200 text-status-warn-800 text-xs font-bold">
                          Happens in: {t.location}
                        </span>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function labelForTab(tab: ManualNavTab): string {
  const map: Record<ManualNavTab, string> = {
    overview: "Overview",
    staff: "Staff",
    menu: "Menu",
    analytics: "Analytics",
    controls: "Controls",
    vip: "VIP",
    books: "Books",
  };
  return map[tab];
}
