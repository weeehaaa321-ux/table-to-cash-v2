import type { Staff } from "../staff/Staff";
import type { StaffId } from "../staff/Staff";

/**
 * Driver auto-assignment — pure rules.
 *
 * Source repo: src/lib/delivery-assignment.ts. Logic:
 *   1. Filter to active DELIVERY-role staff with deliveryOnline=true
 *   2. If none, no assignment is possible → caller disables delivery
 *      on the LP until at least one driver toggles online
 *   3. If one or more, pick the one with the fewest currently-assigned
 *      orders (load balancing). Tie-broken by lowest StaffId for
 *      determinism (avoids flapping).
 *
 * Currently no GPS-distance component — drivers are colocated at the
 * cafe per source repo. If/when distance matters, this is the place
 * to add it (single function, single test surface).
 */
export type CurrentLoad = ReadonlyMap<StaffId, number>;

export type AssignmentInput = {
  candidates: readonly Staff[];
  currentLoad: CurrentLoad;
};

export function pickDriver(input: AssignmentInput): StaffId | null {
  const available = input.candidates.filter((s) => s.isAvailableForDelivery());
  if (available.length === 0) return null;

  const sorted = [...available].sort((a, b) => {
    const la = input.currentLoad.get(a.id) ?? 0;
    const lb = input.currentLoad.get(b.id) ?? 0;
    if (la !== lb) return la - lb;
    return a.id < b.id ? -1 : 1;
  });

  return sorted[0].id;
}

/**
 * Returns true if there is at least one driver online and able to take
 * a new delivery. Used by the LP guard ("delivery disabled — no driver
 * online").
 */
export function hasAvailableDriver(candidates: readonly Staff[]): boolean {
  return candidates.some((s) => s.isAvailableForDelivery());
}
