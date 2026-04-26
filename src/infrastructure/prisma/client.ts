// ─────────────────────────────────────────────────────────────────
// Prisma client singleton.
//
// Source repo: src/lib/db.ts. Same pattern: cache on globalThis to
// survive Next.js hot reload, use Neon serverless driver when
// DATABASE_URL points at Neon.
//
// The repositories in this folder import `db` from here, never from
// "@prisma/client" directly.
// ─────────────────────────────────────────────────────────────────

// Re-export from the legacy `src/lib/db.ts` so v2 infrastructure code
// shares one Prisma instance with the strangler-pattern legacy code.
// When `src/lib/db.ts` is fully retired (Phase 7 cutover), this file
// inlines its body and the legacy file deletes.
export { db } from "@/lib/db";
