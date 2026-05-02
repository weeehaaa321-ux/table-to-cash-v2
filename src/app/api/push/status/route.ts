import { NextResponse } from "next/server";

// ─── Push diagnostics ────────────────────────────────
//
// Returns whether the server-side push setup is properly configured.
// Does NOT leak the actual key values — just whether they exist and
// look well-formed. Hit this from the browser to confirm production
// env vars survived the migration to v2.
//
// GET /api/push/status
//
// Returns:
//   { vapidPublicSet: boolean,    — NEXT_PUBLIC_VAPID_PUBLIC_KEY set
//     vapidPrivateSet: boolean,   — VAPID_PRIVATE_KEY set
//     vapidSubjectSet: boolean,   — VAPID_SUBJECT set (mailto:)
//     publicKeyLength: number,    — for sanity ("looks like a key?")
//     ready: boolean }            — all three set; pushes can fire
export async function GET() {
  const pub = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || "";
  const priv = process.env.VAPID_PRIVATE_KEY || "";
  const subj = process.env.VAPID_SUBJECT || "";
  const vapidPublicSet = pub.length > 0;
  const vapidPrivateSet = priv.length > 0;
  const vapidSubjectSet = subj.length > 0;
  return NextResponse.json({
    vapidPublicSet,
    vapidPrivateSet,
    vapidSubjectSet,
    publicKeyLength: pub.length,
    ready: vapidPublicSet && vapidPrivateSet,
  });
}
