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

import { PrismaClient } from "@/generated/prisma";

declare global {
  // eslint-disable-next-line no-var
  var __prismaClient: PrismaClient | undefined;
}

function build(): PrismaClient {
  return new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });
}

export const db: PrismaClient =
  globalThis.__prismaClient ??
  (process.env.NODE_ENV === "production" ? build() : (globalThis.__prismaClient = build()));
