// Next 13+ entry point that boots the Sentry server / edge configs.
// Without this file, sentry.server.config.ts and sentry.edge.config.ts
// are never imported, so Sentry.init() never runs on the server side
// and only the client gets error reporting. We had this gap on the
// first deploy — instrumentation.ts plugs it.
import * as Sentry from "@sentry/nextjs";

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./sentry.server.config");
  }
  if (process.env.NEXT_RUNTIME === "edge") {
    await import("./sentry.edge.config");
  }
}

// Surface server-side route errors (App Router) to Sentry. Without
// this hook, thrown errors inside route handlers never reach Sentry
// because Next swallows them into its own error pipeline.
export const onRequestError = Sentry.captureRequestError;
