// Cross-page guard for "user just moved themselves to a different table".
// ChangeTableModal sets a sessionStorage flag right after a successful PATCH;
// /menu and /track read it before triggering their own "You've moved tables"
// redirect overlays. Without this guard, the host page's session poll
// consistently raced ahead and unmounted the modal's confirmation screen,
// hiding the "Go to Table # Menu" button.
//
// The flag has a 60s expiry so a stale entry can't suppress a real
// "manager moved you" redirect after the user finished their own move
// flow.

const FLAG_KEY = "ttc_self_moved";
const MAX_AGE_MS = 60_000;

export function isSelfInitiatedMove(
  sessionId: string | null | undefined,
  toTable: string | number | null | undefined,
): boolean {
  if (!sessionId || toTable == null) return false;
  if (typeof window === "undefined") return false;
  let raw: string | null = null;
  try {
    raw = sessionStorage.getItem(FLAG_KEY);
  } catch {
    return false;
  }
  if (!raw) return false;
  try {
    const flag = JSON.parse(raw) as { sessionId?: string; toTable?: string; ts?: number };
    if (!flag.sessionId || !flag.toTable || !flag.ts) return false;
    if (Date.now() - flag.ts > MAX_AGE_MS) {
      try { sessionStorage.removeItem(FLAG_KEY); } catch {}
      return false;
    }
    return flag.sessionId === sessionId && String(flag.toTable) === String(toTable);
  } catch {
    return false;
  }
}
