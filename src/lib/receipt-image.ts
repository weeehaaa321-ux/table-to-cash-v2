// Draws a multi-round receipt to a canvas and triggers a PNG download.
// Dependency-free (no html2canvas/html-to-image) — we own the data, so
// rendering directly gives us a crisp thermal-receipt look and avoids
// DOM-scraping flakiness across browsers.

export type ReceiptOrderItem = { name: string; quantity: number; price: number };
export type ReceiptOrder = {
  orderNumber: number;
  total: number;
  guestNumber?: number | null;
  items: ReceiptOrderItem[];
};

export type ReceiptRound = {
  index: number;
  paidAt: string | null;
  paymentMethod: string | null;
  orders: ReceiptOrder[];
  subtotal: number;
};

export type MultiRoundReceiptData = {
  tableNumber: string | number;
  rounds: ReceiptRound[];
  tip: number;
  grandTotal: number;
  lang: "en" | "ar";
};

const WIDTH = 720;
const PAD = 48;
const SCALE = 2; // retina

export function downloadReceiptImage(data: MultiRoundReceiptData) {
  const isAr = data.lang === "ar";
  const L = (en: string, ar: string) => (isAr ? ar : en);

  // Per-guest breakdown across every round so split-check dinners can
  // see who owes what at a glance. Guest 0 = unassigned.
  const perGuestMap = new Map<number, number>();
  for (const r of data.rounds) {
    for (const o of r.orders) {
      const g = o.guestNumber && o.guestNumber > 0 ? o.guestNumber : 0;
      perGuestMap.set(g, (perGuestMap.get(g) ?? 0) + o.total);
    }
  }
  const perGuest = Array.from(perGuestMap.entries())
    .map(([guest, total]) => ({ guest, total }))
    .sort((a, b) => a.guest - b.guest);
  const hasPerGuest = perGuest.length > 1 || (perGuest[0]?.guest ?? 0) > 0;

  // Pre-compute canvas height so we can allocate once.
  const itemH = 26;
  const lineH = 28;
  let h = PAD; // top
  h += 56; // title
  h += 24; // table label
  h += 24; // spacer + divider
  for (const r of data.rounds) {
    h += 34; // round header bar
    for (const o of r.orders) {
      h += 24; // order header line
      h += o.items.length * itemH;
      h += 22; // subtotal
      h += 14; // gap
    }
    h += 28; // round total line
    h += 16; // gap
  }
  h += 8; // divider gap
  if (hasPerGuest) {
    h += 18; // "Per guest" header
    h += perGuest.length * 20; // one row per guest
    h += 12; // gap
  }
  if (data.rounds.length > 1) h += lineH; // "Orders total" when >1 round
  if (data.tip > 0) h += lineH;
  h += 52; // grand total block
  h += 26; // footer
  h += PAD; // bottom

  const canvas = document.createElement("canvas");
  canvas.width = WIDTH * SCALE;
  canvas.height = h * SCALE;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.scale(SCALE, SCALE);

  // Background
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, WIDTH, h);

  // Title
  let y = PAD + 8;
  ctx.fillStyle = "#0f172a";
  ctx.font = "900 34px -apple-system, 'Segoe UI', system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText(L("RECEIPT", "الفاتورة"), WIDTH / 2, y);
  y += 28;

  ctx.fillStyle = "#94a3b8";
  ctx.font = "700 13px -apple-system, system-ui, sans-serif";
  ctx.fillText(
    L(`TABLE ${data.tableNumber}`, `طاولة ${data.tableNumber}`).toUpperCase(),
    WIDTH / 2,
    y
  );
  y += 32;

  drawDashedLine(ctx, PAD, y, WIDTH - PAD, y);
  y += 20;

  ctx.textAlign = "left";

  // Rounds
  for (const round of data.rounds) {
    // Round header bar
    ctx.fillStyle = "#0f172a";
    ctx.fillRect(PAD, y, WIDTH - PAD * 2, 26);
    ctx.fillStyle = "#ffffff";
    ctx.font = "900 13px -apple-system, system-ui, sans-serif";
    ctx.fillText(
      L(`ROUND ${round.index}`, `جولة ${round.index}`).toUpperCase(),
      PAD + 12,
      y + 17
    );
    if (round.paymentMethod) {
      ctx.textAlign = "right";
      ctx.fillText(round.paymentMethod.toUpperCase(), WIDTH - PAD - 12, y + 17);
      ctx.textAlign = "left";
    }
    y += 34;

    // Orders in this round
    for (const o of round.orders) {
      ctx.fillStyle = "#64748b";
      ctx.font = "800 11px -apple-system, system-ui, sans-serif";
      const header = L(`ORDER #${o.orderNumber}`, `طلب #${o.orderNumber}`)
        + (o.guestNumber && o.guestNumber > 0 ? `   ·   G${o.guestNumber}` : "");
      ctx.fillText(header.toUpperCase(), PAD, y + 8);
      y += 22;

      ctx.font = "500 15px -apple-system, system-ui, sans-serif";
      for (const it of o.items) {
        ctx.fillStyle = "#334155";
        const label = `${it.quantity}×  ${it.name || "Item"}`;
        ctx.fillText(truncate(ctx, label, WIDTH - PAD * 2 - 120), PAD, y + 12);
        ctx.fillStyle = "#64748b";
        ctx.textAlign = "right";
        ctx.fillText(`${it.price * it.quantity} EGP`, WIDTH - PAD, y + 12);
        ctx.textAlign = "left";
        y += itemH;
      }

      ctx.fillStyle = "#0f172a";
      ctx.font = "700 13px -apple-system, system-ui, sans-serif";
      ctx.fillText(L("Subtotal", "المجموع"), PAD, y + 14);
      ctx.textAlign = "right";
      ctx.fillText(`${o.total} EGP`, WIDTH - PAD, y + 14);
      ctx.textAlign = "left";
      y += 22;

      y += 14;
    }

    // Round total
    ctx.fillStyle = "#059669";
    ctx.font = "900 14px -apple-system, system-ui, sans-serif";
    ctx.fillText(
      L(`ROUND ${round.index} TOTAL`, `إجمالي الجولة ${round.index}`).toUpperCase(),
      PAD,
      y + 14
    );
    ctx.textAlign = "right";
    ctx.fillText(`${round.subtotal} EGP`, WIDTH - PAD, y + 14);
    ctx.textAlign = "left";
    y += 28;
    y += 16;
  }

  y += 8;
  drawDashedLine(ctx, PAD, y, WIDTH - PAD, y);
  y += 14;

  // Per-guest breakdown
  if (hasPerGuest) {
    ctx.fillStyle = "#94a3b8";
    ctx.font = "800 10px -apple-system, system-ui, sans-serif";
    ctx.fillText(L("PER GUEST", "لكل ضيف"), PAD, y + 10);
    y += 18;
    ctx.font = "500 12px -apple-system, system-ui, sans-serif";
    for (const { guest, total } of perGuest) {
      const label = guest > 0
        ? L(`Guest ${guest}`, `الضيف ${guest}`)
        : L("Unassigned", "غير محدد");
      ctx.fillStyle = "#64748b";
      ctx.fillText(label, PAD + 8, y + 10);
      ctx.textAlign = "right";
      ctx.fillStyle = "#334155";
      ctx.fillText(`${total} EGP`, WIDTH - PAD, y + 10);
      ctx.textAlign = "left";
      y += 20;
    }
    y += 12;
  }

  // Cross-round totals
  if (data.rounds.length > 1) {
    const ordersTotal = data.rounds.reduce((s, r) => s + r.subtotal, 0);
    ctx.fillStyle = "#64748b";
    ctx.font = "600 14px -apple-system, system-ui, sans-serif";
    ctx.fillText(L("All rounds", "كل الجولات"), PAD, y + 14);
    ctx.textAlign = "right";
    ctx.fillStyle = "#334155";
    ctx.fillText(`${ordersTotal} EGP`, WIDTH - PAD, y + 14);
    ctx.textAlign = "left";
    y += lineH;
  }

  if (data.tip > 0) {
    ctx.fillStyle = "#64748b";
    ctx.font = "600 14px -apple-system, system-ui, sans-serif";
    ctx.fillText(L("Tip", "البقشيش"), PAD, y + 14);
    ctx.textAlign = "right";
    ctx.fillStyle = "#334155";
    ctx.fillText(`${data.tip} EGP`, WIDTH - PAD, y + 14);
    ctx.textAlign = "left";
    y += lineH;
  }

  y += 10;
  ctx.strokeStyle = "#0f172a";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(PAD, y);
  ctx.lineTo(WIDTH - PAD, y);
  ctx.stroke();
  y += 24;

  ctx.fillStyle = "#0f172a";
  ctx.font = "900 22px -apple-system, system-ui, sans-serif";
  ctx.fillText(L("GRAND TOTAL", "الإجمالي"), PAD, y + 8);
  ctx.textAlign = "right";
  ctx.fillStyle = "#059669";
  ctx.font = "900 26px -apple-system, system-ui, sans-serif";
  ctx.fillText(`${data.grandTotal} EGP`, WIDTH - PAD, y + 8);
  ctx.textAlign = "left";
  y += 42;

  // Footer
  ctx.fillStyle = "#cbd5e1";
  ctx.font = "500 11px -apple-system, system-ui, sans-serif";
  ctx.textAlign = "center";
  const lastPaid = data.rounds[data.rounds.length - 1]?.paidAt;
  if (lastPaid) ctx.fillText(formatDate(lastPaid, isAr), WIDTH / 2, y + 8);

  canvas.toBlob((blob) => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `receipt-table-${data.tableNumber}-${Date.now()}.png`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, "image/png");
}

function drawDashedLine(ctx: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number) {
  ctx.save();
  ctx.strokeStyle = "#e2e8f0";
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 4]);
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
  ctx.restore();
}

function truncate(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(t + "…").width > maxWidth) {
    t = t.slice(0, -1);
  }
  return t + "…";
}

function formatDate(iso: string, ar: boolean): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString(ar ? "ar-EG" : "en-US", {
      dateStyle: "medium",
      timeStyle: "short",
    });
  } catch {
    return "";
  }
}
