// ═══════════════════════════════════════════════════════
// PRINT AGENT — runs on the cashier's Windows PC.
//
// Problem: the Vercel server can't reach the Xprinter XB-80T over the
// restaurant's LAN. Browsers can't open raw TCP sockets. So this tiny
// Node script bridges the gap:
//
//   Cashier web app  --HTTP-->  localhost:9911  --TCP:9100-->  printer
//
// Setup (one time, on the cashier PC):
//   1. Install Node 20+.
//   2. Give the Xprinter XB-80T a static LAN IP (e.g. 192.168.1.50).
//   3. Open port 9911 in Windows Firewall (localhost only).
//   4. Run on startup via Task Scheduler or NSSM:
//
//      set PRINTER_IP=192.168.1.50
//      set APP_URL=https://your-app.vercel.app
//      node scripts/print-agent.mjs
//
// Then from the cashier page:
//   POST http://localhost:9911/print { sessionId }
// ═══════════════════════════════════════════════════════

import http from "node:http";
import net from "node:net";

const PORT = Number(process.env.AGENT_PORT || 9911);
const PRINTER_IP = process.env.PRINTER_IP;
const PRINTER_PORT = Number(process.env.PRINTER_PORT || 9100);
const APP_URL = (process.env.APP_URL || "http://localhost:3000").replace(/\/$/, "");

if (!PRINTER_IP) {
  console.error("PRINTER_IP env var is required (e.g. PRINTER_IP=192.168.1.50).");
  process.exit(1);
}

// ─── ESC/POS builder (inlined so this script is pure Node, no TS step) ───

const ESC = 0x1b;
const GS = 0x1d;
const LF = 0x0a;

function encodeText(s) {
  const bytes = [];
  for (const ch of String(s)) {
    const code = ch.charCodeAt(0);
    if (code < 0x20 && code !== 0x0a) continue;
    if (code < 0x80 || (code >= 0xa0 && code <= 0xff)) {
      bytes.push(code);
    } else {
      bytes.push(0x3f);
    }
  }
  return bytes;
}

function push(out, ...bs) { for (const b of bs) out.push(b); }
function text(out, s) { out.push(...encodeText(s)); }

function row(left, right, width = 48) {
  const L = String(left), R = String(right);
  const space = Math.max(1, width - L.length - R.length);
  return L + " ".repeat(space) + R;
}
const divider = (w = 48) => "-".repeat(w);

function buildInvoice(inv) {
  const out = [];
  push(out, ESC, 0x40);           // reset
  push(out, ESC, 0x74, 0x13);     // CP858

  push(out, ESC, 0x61, 0x01);     // center
  push(out, ESC, 0x21, 0x30);     // double
  text(out, inv.restaurantName);
  push(out, LF);
  push(out, ESC, 0x21, 0x00);
  text(out, divider());
  push(out, LF);

  push(out, ESC, 0x61, 0x00);     // left
  const date = new Date(inv.paidAt);
  const dateStr = date.toLocaleDateString("en-GB", { day: "2-digit", month: "2-digit", year: "numeric" });
  const timeStr = date.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  text(out, inv.tableNumber != null ? `Table: ${inv.tableNumber}` : `Guest: ${inv.vipGuestName || "VIP"}`);
  if (inv.guestCount > 0) text(out, `   Guests: ${inv.guestCount}`);
  push(out, LF);
  if (inv.waiterName) { text(out, `Server: ${inv.waiterName}`); push(out, LF); }
  text(out, `Date:   ${dateStr} ${timeStr}`); push(out, LF);
  text(out, `Inv:    ${String(inv.sessionId).slice(-8).toUpperCase()}`); push(out, LF);

  const rounds = inv.rounds || [];
  const current = rounds[rounds.length - 1];
  const prior = rounds.slice(0, -1);
  const isMultiRound = rounds.length > 1;

  if (isMultiRound && current) {
    push(out, LF);
    push(out, ESC, 0x61, 0x01);
    push(out, ESC, 0x21, 0x08);
    text(out, `-- ROUND ${current.index} OF ${rounds.length} --`);
    push(out, ESC, 0x21, 0x00);
    push(out, ESC, 0x61, 0x00);
    push(out, LF);
  } else {
    text(out, divider()); push(out, LF);
  }

  text(out, row("Item", inv.currency)); push(out, LF);
  text(out, divider()); push(out, LF);

  const items = current?.items ?? [];
  for (const it of items) {
    const left = `${it.quantity}x ${it.name}`.slice(0, 36);
    const right = `${Math.round(it.price * it.quantity)}`;
    text(out, row(left, right)); push(out, LF);
  }
  text(out, divider()); push(out, LF);

  push(out, ESC, 0x21, 0x30);
  const totalLabel = isMultiRound ? "THIS ROUND" : "TOTAL";
  const totalValue = `${current?.subtotal ?? inv.total} ${inv.currency}`;
  text(out, row(totalLabel, totalValue, 24)); push(out, LF);
  push(out, ESC, 0x21, 0x00);

  if (current?.paymentMethod) {
    text(out, row("Paid by", current.paymentMethod)); push(out, LF);
  }

  if (prior.length > 0) {
    push(out, LF);
    text(out, "Previously paid:"); push(out, LF);
    for (const r of prior) {
      const label = `Round ${r.index}${r.paymentMethod ? ` (${r.paymentMethod})` : ""}`;
      text(out, row(label, `${r.subtotal} ${inv.currency}`)); push(out, LF);
    }
    text(out, divider()); push(out, LF);
    text(out, row("Lifetime total", `${inv.total} ${inv.currency}`)); push(out, LF);
  }

  push(out, LF);
  push(out, ESC, 0x61, 0x01);
  text(out, "Thank you for dining with us!");
  push(out, LF, LF, LF, LF);
  push(out, GS, 0x56, 0x00);      // full cut

  return Buffer.from(out);
}

// ─── network ───

function sendToPrinter(bytes) {
  return new Promise((resolve, reject) => {
    const socket = new net.Socket();
    socket.setTimeout(5000);
    socket.once("error", reject);
    socket.once("timeout", () => { socket.destroy(); reject(new Error("Printer connection timed out")); });
    socket.connect(PRINTER_PORT, PRINTER_IP, () => socket.write(bytes, () => socket.end()));
    socket.once("close", resolve);
  });
}

async function fetchInvoice(sessionId) {
  const res = await fetch(`${APP_URL}/api/invoice?sessionId=${encodeURIComponent(sessionId)}`);
  if (!res.ok) throw new Error(`invoice fetch ${res.status}`);
  return res.json();
}

const server = http.createServer(async (req, res) => {
  res.setHeader("access-control-allow-origin", "*");
  res.setHeader("access-control-allow-methods", "POST, GET, OPTIONS");
  res.setHeader("access-control-allow-headers", "content-type");

  if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return; }

  if (req.method === "GET" && req.url === "/health") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true, printer: `${PRINTER_IP}:${PRINTER_PORT}` }));
    return;
  }

  if (req.method === "POST" && req.url === "/print") {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", async () => {
      try {
        const { sessionId } = JSON.parse(body || "{}");
        if (!sessionId) throw new Error("sessionId required");
        const inv = await fetchInvoice(sessionId);
        const current = inv.rounds?.[inv.rounds.length - 1];
        const bytes = buildInvoice({
          restaurantName: inv.restaurantName,
          currency: inv.currency,
          tableNumber: inv.tableNumber,
          vipGuestName: inv.vipGuestName ?? null,
          guestCount: inv.guestCount || 0,
          waiterName: inv.waiterName,
          sessionId: inv.sessionId,
          paidAt: current?.paidAt || inv.closedAt || new Date().toISOString(),
          rounds: inv.rounds || [],
          total: inv.total,
        });
        await sendToPrinter(bytes);
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
      } catch (err) {
        console.error("print failed:", err);
        res.writeHead(500, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: false, error: String(err.message || err) }));
      }
    });
    return;
  }

  res.writeHead(404);
  res.end();
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`Print agent on http://127.0.0.1:${PORT} -> ${PRINTER_IP}:${PRINTER_PORT}`);
  console.log(`App:      ${APP_URL}`);
});
