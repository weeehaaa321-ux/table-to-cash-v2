import { NextResponse } from "next/server";

// Returns the currently-deployed build id. The cashier tab polls this
// and compares against its own bundled NEXT_PUBLIC_BUILD_ID — if the
// server has rolled forward, the client shows a "new version available"
// banner and (when idle + not mid-payment) soft-reloads itself.
//
// Honors Vercel's built-in commit SHA, falls back to a manually set
// BUILD_ID env, then to "dev" so local dev never trips the banner.
//
// Migrated from src/app/api/version/route.ts in source repo. Response
// shape: byte-identical.
//
// NOTE on env access: this is one of the ~3 places we deliberately
// read process.env directly rather than going through
// infrastructure/config/env. Reason: Next.js inlines these specific
// vars at build time, so going through a wrapper would prevent the
// build-time substitution and break the "did the deploy roll forward"
// signal entirely. Documented exception.
export async function GET() {
  const version =
    process.env.VERCEL_GIT_COMMIT_SHA ||
    process.env.BUILD_ID ||
    "dev";
  return NextResponse.json(
    { version },
    { headers: { "Cache-Control": "no-store" } },
  );
}
