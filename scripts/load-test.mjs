#!/usr/bin/env node
// Load test for table-to-cash. Simulates 50 guest tables + 20 staff devices.
// Usage:
//   BASE_URL=https://your-preview.vercel.app RESTAURANT=neom-cafe node scripts/load-test.mjs
//
// Required env:
//   BASE_URL    — full URL of the Vercel deployment to test (NO trailing slash)
//   RESTAURANT  — slug or cuid of the restaurant
//
// Optional env:
//   STAFF=20         — number of staff devices polling /api/live-snapshot
//   GUESTS=50        — number of guest sessions to spawn over the run
//   DURATION_MIN=10  — total run length in minutes
//   POLL_MS=20000    — staff poll interval (matches use-live-data.ts)
//   SPAWN_RATE=2     — guest sessions started per second (rampup)
//
// Safety: point this at a STAGING deployment with a Neon BRANCH database.
// Do not run against production with real customer data.

const BASE = (process.env.BASE_URL || "").replace(/\/$/, "");
const RESTAURANT = process.env.RESTAURANT || "";
const STAFF = parseInt(process.env.STAFF || "20", 10);
const GUESTS = parseInt(process.env.GUESTS || "50", 10);
const DURATION_MIN = parseFloat(process.env.DURATION_MIN || "10");
const POLL_MS = parseInt(process.env.POLL_MS || "20000", 10);
const SPAWN_RATE = parseFloat(process.env.SPAWN_RATE || "2");

if (!BASE || !RESTAURANT) {
  console.error("Missing BASE_URL or RESTAURANT env. Example:");
  console.error("  BASE_URL=https://ttc-preview.vercel.app RESTAURANT=neom-cafe node scripts/load-test.mjs");
  process.exit(1);
}

// Guard: refuse to hammer the production deployment unless the caller
// explicitly opts in. The known prod aliases are ttc-ivory.vercel.app
// and neom.net; a preview URL is fine to run against by default.
const PROD_HOSTS = ["ttc-ivory.vercel.app", "neom.net", "www.neom.net"];
const baseHost = new URL(BASE).host;
if (PROD_HOSTS.includes(baseHost) && process.env.ALLOW_PROD_WRITE !== "1") {
  console.error(`Refusing to load-test ${baseHost} without ALLOW_PROD_WRITE=1.`);
  console.error("Point BASE_URL at a preview deployment backed by a Neon branch.");
  process.exit(1);
}

// Vercel protection bypass: append as query param on every request.
// Node fetch doesn't persist cookies, so header/cookie approach causes redirect loops.
const BYPASS = process.env.BYPASS || "";
const _origFetch = globalThis.fetch;
globalThis.fetch = (url, opts = {}) => {
  if (!BYPASS) return _origFetch(url, opts);
  const u = new URL(url);
  u.searchParams.set("x-vercel-protection-bypass", BYPASS);
  const headers = new Headers(opts.headers || {});
  headers.set("x-vercel-protection-bypass", BYPASS);
  return _origFetch(u.toString(), { ...opts, headers, redirect: "manual" });
};

// ── Per-route latency + error tracking ─────────────────────────────────
const stats = new Map(); // route -> { samples: [], errors: 0, statuses: Map }

function record(route, durationMs, status, errorBody) {
  if (!stats.has(route)) stats.set(route, { samples: [], errors: 0, statuses: new Map() });
  const s = stats.get(route);
  s.samples.push(durationMs);
  s.statuses.set(status, (s.statuses.get(status) || 0) + 1);
  if (status >= 400 || status === 0) {
    s.errors++;
    if (s.errors <= 5) {
      console.error(`  ✗ ${route} → ${status} ${errorBody?.slice(0, 200) || ""}`);
    }
  }
}

async function timed(route, fn) {
  const start = Date.now();
  try {
    const res = await fn();
    const dur = Date.now() - start;
    let body = "";
    if (res.status >= 400) {
      try { body = await res.text(); } catch {}
    }
    record(route, dur, res.status, body);
    return res;
  } catch (e) {
    record(route, Date.now() - start, 0, e?.message || String(e));
    return null;
  }
}

// ── API helpers ────────────────────────────────────────────────────────
const api = {
  menu: () => timed("GET /api/menu", () =>
    fetch(`${BASE}/api/menu/${RESTAURANT}`)
  ),
  snapshot: () => timed("GET /api/live-snapshot", () =>
    fetch(`${BASE}/api/live-snapshot?restaurantId=${RESTAURANT}`)
  ),
  openSession: (tableNumber) => timed("POST /api/sessions", () =>
    fetch(`${BASE}/api/sessions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ restaurantId: RESTAURANT, tableNumber: String(tableNumber), guestCount: 2 }),
    })
  ),
  createOrder: (sessionId, tableNumber, items) => {
    const subtotal = items.reduce((s, i) => s + (i.price || 0), 0);
    return timed("POST /api/orders", () =>
      fetch(`${BASE}/api/orders`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          restaurantId: RESTAURANT,
          sessionId,
          tableId: String(tableNumber),
          subtotal,
          total: subtotal,
          tip: 0,
          language: "en",
          items: items.map((i) => ({
            menuItemId: i.id,
            quantity: 1,
            price: i.price || 0,
            addOns: [],
            wasUpsell: false,
            notes: "",
          })),
        }),
      })
    );
  },
  pay: (sessionId) => timed("POST /api/sessions/pay", () =>
    fetch(`${BASE}/api/sessions/pay`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sessionId, paymentMethod: "CASH" }),
    })
  ),
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const jitter = (ms) => Math.floor(ms * (0.85 + Math.random() * 0.3));

// ── Workers ────────────────────────────────────────────────────────────
async function staffWorker(id, stopAt, menuItems) {
  // Stagger start so all 20 don't fire on the same tick
  await sleep(Math.random() * POLL_MS);
  while (Date.now() < stopAt) {
    await api.snapshot();
    await sleep(jitter(POLL_MS));
  }
}

async function guestWorker(tableNumber, menuItems) {
  // Open session
  const sRes = await api.openSession(tableNumber);
  if (!sRes || !sRes.ok) return;
  const session = await sRes.json().catch(() => null);
  if (!session?.id) return;

  // Browse menu (1 fetch, like a real guest)
  await api.menu();

  // Wait a beat (guest reading menu)
  await sleep(jitter(2000));

  // Order 3 random items
  const picks = [];
  for (let i = 0; i < 3; i++) {
    picks.push(menuItems[Math.floor(Math.random() * menuItems.length)]);
  }
  await api.createOrder(session.id, tableNumber, picks);

  // Eat for a bit (compressed — real is 30-60min)
  await sleep(jitter(5000));

  // Maybe order one more round (50%)
  if (Math.random() < 0.5) {
    const more = [menuItems[Math.floor(Math.random() * menuItems.length)]];
    await api.createOrder(session.id, tableNumber, more);
    await sleep(jitter(3000));
  }

  // Pay
  await api.pay(session.id);
}

// ── Stats reporter ─────────────────────────────────────────────────────
function pct(arr, p) {
  if (!arr.length) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx];
}

function report() {
  console.log("\n" + "═".repeat(78));
  console.log("LOAD TEST RESULTS");
  console.log("═".repeat(78));
  const rows = [];
  for (const [route, s] of stats) {
    rows.push({
      route,
      n: s.samples.length,
      errors: s.errors,
      errPct: s.samples.length ? ((s.errors / s.samples.length) * 100).toFixed(1) : "0.0",
      p50: pct(s.samples, 50),
      p95: pct(s.samples, 95),
      p99: pct(s.samples, 99),
      max: s.samples.length ? Math.max(...s.samples) : 0,
      statuses: [...s.statuses.entries()].map(([k, v]) => `${k}:${v}`).join(" "),
    });
  }
  rows.sort((a, b) => b.n - a.n);
  const fmt = (v, w) => String(v).padStart(w);
  console.log(
    `${"route".padEnd(28)} ${fmt("n", 5)} ${fmt("err%", 5)} ${fmt("p50", 6)} ${fmt("p95", 6)} ${fmt("p99", 6)} ${fmt("max", 6)}  statuses`
  );
  console.log("─".repeat(78));
  for (const r of rows) {
    console.log(
      `${r.route.padEnd(28)} ${fmt(r.n, 5)} ${fmt(r.errPct, 5)} ${fmt(r.p50, 6)} ${fmt(r.p95, 6)} ${fmt(r.p99, 6)} ${fmt(r.max, 6)}  ${r.statuses}`
    );
  }
  console.log("═".repeat(78));
  console.log("Targets for 'green': p95 < 500ms, error% < 1%");
  console.log("Yellow: p95 500-1500ms, error% 1-3%. Red: anything worse.\n");
}

// ── Main ────────────────────────────────────────────────────────────────
async function main() {
  console.log(`Target:      ${BASE}`);
  console.log(`Restaurant:  ${RESTAURANT}`);
  console.log(`Staff:       ${STAFF} devices polling every ${POLL_MS}ms`);
  console.log(`Guests:      ${GUESTS} sessions, spawned at ${SPAWN_RATE}/sec`);
  console.log(`Duration:    ${DURATION_MIN} min`);
  console.log("");

  // Prefetch menu so guests have item IDs to order
  console.log("Fetching menu...");
  const menuRes = await fetch(`${BASE}/api/menu/${RESTAURANT}`);
  if (!menuRes.ok) {
    console.error(`Menu fetch failed: ${menuRes.status}`);
    process.exit(1);
  }
  const menu = await menuRes.json();
  // Menu shape: array of categories, each with .items
  const items = [];
  const cats = Array.isArray(menu) ? menu : menu.categories || [];
  for (const cat of cats) {
    for (const it of cat.items || []) {
      if (it.available !== false) items.push({ id: it.id, price: it.price || 0 });
    }
  }
  if (!items.length) {
    console.error("No menu items found. Is the restaurant seeded?");
    process.exit(1);
  }
  console.log(`Loaded ${items.length} menu items.\n`);

  const stopAt = Date.now() + DURATION_MIN * 60 * 1000;

  // Spawn staff workers
  const staffPromises = [];
  for (let i = 0; i < STAFF; i++) {
    staffPromises.push(staffWorker(i, stopAt, items));
  }

  // Spawn guests at SPAWN_RATE/sec until GUESTS spawned or duration ends
  const guestPromises = [];
  let guestCount = 0;
  const spawnInterval = 1000 / SPAWN_RATE;
  const reportInterval = setInterval(() => {
    const totalReq = [...stats.values()].reduce((a, s) => a + s.samples.length, 0);
    const totalErr = [...stats.values()].reduce((a, s) => a + s.errors, 0);
    process.stdout.write(`  [${Math.round((stopAt - Date.now()) / 1000)}s left] requests: ${totalReq}, errors: ${totalErr}        \r`);
  }, 2000);

  while (guestCount < GUESTS && Date.now() < stopAt) {
    const tableNumber = (guestCount % 50) + 1;
    guestPromises.push(guestWorker(tableNumber, items));
    guestCount++;
    await sleep(spawnInterval);
  }
  console.log(`\nAll ${guestCount} guests spawned. Waiting for completion...`);

  await Promise.all(guestPromises);
  // Let staff finish current poll
  await Promise.race([Promise.all(staffPromises), sleep(POLL_MS + 1000)]);

  clearInterval(reportInterval);
  report();
}

main().catch((e) => {
  console.error("Fatal:", e);
  report();
  process.exit(1);
});
