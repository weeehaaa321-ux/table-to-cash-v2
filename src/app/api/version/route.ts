import { NextResponse } from "next/server";

// Returns the currently-deployed build id. The cashier tab polls this
// and compares against its own bundled NEXT_PUBLIC_BUILD_ID — if the
// server has rolled forward, the client shows a "new version available"
// banner and (when idle + not mid-payment) soft-reloads itself.
//
// Honors Vercel's built-in commit SHA, falls back to a manually set
// BUILD_ID env, then to "dev" so local dev never trips the banner.
export async function GET() {
  const version =
    process.env.VERCEL_GIT_COMMIT_SHA ||
    process.env.BUILD_ID ||
    "dev";
  return NextResponse.json(
    { version },
    { headers: { "Cache-Control": "no-store" } }
  );
}
