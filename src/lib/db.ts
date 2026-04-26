import { PrismaClient } from "@/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient | undefined };

function createClient(): PrismaClient {
  const url = process.env.DATABASE_URL;
  if (!url || url.includes("johndoe:randompassword")) {
    return new Proxy({} as PrismaClient, {
      get(_target, prop) {
        if (typeof prop === "symbol" || prop === "then" || prop === "toJSON") {
          return undefined;
        }
        throw new Error(
          `Database not configured. Set DATABASE_URL in your environment variables. (Attempted to access db.${String(prop)})`
        );
      },
    });
  }

  // Strip channel_binding param which can cause issues on serverless
  const cleanUrl = url.replace(/[&?]channel_binding=[^&]*/g, "");
  const adapter = new PrismaPg({ connectionString: cleanUrl });
  return new PrismaClient({ adapter });
}

export const db = globalForPrisma.prisma ?? createClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = db;
