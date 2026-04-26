/**
 * Wrapper around fetch that injects x-staff-id header for authenticated
 * staff API calls. Use this from any staff page (waiter, kitchen, cashier,
 * bar, floor, delivery, dashboard) when calling staff-protected endpoints.
 */
export function staffFetch(
  staffId: string | null | undefined,
  url: string,
  init?: RequestInit
): Promise<Response> {
  const headers = new Headers(init?.headers);
  if (!headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  if (staffId) headers.set("x-staff-id", staffId);
  return fetch(url, { ...init, headers });
}
