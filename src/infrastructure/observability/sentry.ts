// ─────────────────────────────────────────────────────────────────
// Sentry adapter — central re-export of Sentry helpers used across
// the codebase. The actual init lives in the root sentry.{client,
// server,edge}.config.ts files (Next.js convention).
//
// Per docs/INVENTORY.md §14 Q9: settings are deliberate. Don't
// change them here.
// ─────────────────────────────────────────────────────────────────

export { captureException, withScope } from "@sentry/nextjs";
