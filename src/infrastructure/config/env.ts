// ─────────────────────────────────────────────────────────────────
// Single source of env-var truth.
//
// Per docs/ARCHITECTURE.md "Rules with teeth" #7: no `process.env.X`
// outside this file. Every other layer imports from `env`.
//
// Reads + validates at module import. Throws on missing required vars
// at server startup, so misconfiguration fails loud, not silently.
//
// Mirrors source repo .env.example exactly.
// ─────────────────────────────────────────────────────────────────

function required(name: string): string {
  const v = process.env[name];
  if (!v || v.length === 0) {
    throw new Error(`env: required var ${name} is not set`);
  }
  return v;
}

function optional(name: string, fallback = ""): string {
  return process.env[name] ?? fallback;
}

function optionalNumber(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = parseInt(raw, 10);
  return isFinite(n) ? n : fallback;
}

// We intentionally only read NEXT_PUBLIC_* vars statically — Next.js
// inlines them into the client bundle, so the same code works on both
// sides. Server-only vars (DATABASE_URL, VAPID_PRIVATE_KEY,
// CRON_SECRET) are read lazily inside helpers so the client bundle
// doesn't reference them.

export const env = {
  // ─── Restaurant config (build-time, NEXT_PUBLIC_*) ────────────
  RESTAURANT_SLUG: optional("NEXT_PUBLIC_RESTAURANT_SLUG", "neom-dahab"),
  RESTAURANT_NAME: optional("NEXT_PUBLIC_RESTAURANT_NAME", "Neom Dahab"),
  RESTAURANT_TZ: optional("NEXT_PUBLIC_RESTAURANT_TZ", "Africa/Cairo"),
  RESTAURANT_CURRENCY: optional("NEXT_PUBLIC_RESTAURANT_CURRENCY", "EGP"),
  DELIVERY_FEE_MAJOR: optionalNumber("NEXT_PUBLIC_DELIVERY_FEE", 50),

  // ─── Public-side observability ────────────────────────────────
  SENTRY_DSN: optional("NEXT_PUBLIC_SENTRY_DSN"),
  BUILD_ID: optional("NEXT_PUBLIC_BUILD_ID", optional("BUILD_ID", "dev")),

  // ─── VAPID (web push) ─────────────────────────────────────────
  VAPID_PUBLIC_KEY: optional("NEXT_PUBLIC_VAPID_PUBLIC_KEY"),

  // ─── Server-only access helpers ────────────────────────────────
  // These throw if called from a context where the var isn't set.
  serverOnly: {
    databaseUrl: () => required("DATABASE_URL"),
    vapidPrivateKey: () => required("VAPID_PRIVATE_KEY"),
    vapidSubject: () => optional("VAPID_SUBJECT", "mailto:admin@example.com"),
    cronSecret: () => required("CRON_SECRET"),
  },

  isProduction: process.env.NODE_ENV === "production",
} as const;
