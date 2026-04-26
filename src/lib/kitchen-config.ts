// Per-restaurant kitchen capacity configuration.
//
// maxParallel   = how many active orders push the kitchen to 100% load.
// stationCaps   = per-station parallel-item limits (used on the kitchen board).
// thresholds    = load levels that drive colors/alerts/orchestrator decisions.

export type KitchenThresholds = {
  warn: number;     // yellow
  critical: number; // red
};

export type KitchenConfig = {
  maxParallel: number;
  stationCaps: {
    grill: number;
    fryer: number;
    bar: number;
    dessert: number;
    cold: number;
    pasta: number;
  };
  thresholds: KitchenThresholds;
};

export const DEFAULT_KITCHEN_CONFIG: KitchenConfig = {
  maxParallel: 8,
  stationCaps: { grill: 4, fryer: 3, bar: 6, dessert: 3, cold: 4, pasta: 3 },
  thresholds: { warn: 65, critical: 85 },
};

// Accept whatever shape is in the DB Json column and coerce to a full config.
// Missing keys fall back to defaults so old restaurants never break.
// Invariants enforced:
//   maxParallel  >= 1
//   stationCaps  >= 1  (division by zero would strand the station load bar at 100%)
//   thresholds   0..100 AND warn <= critical
export function normalizeKitchenConfig(raw: unknown): KitchenConfig {
  const d = DEFAULT_KITCHEN_CONFIG;
  const capFloor = (n: unknown, fallback: number): number => {
    const v = typeof n === "number" && Number.isFinite(n) ? Math.floor(n) : fallback;
    return Math.max(1, v);
  };
  const pctClamp = (n: unknown, fallback: number): number => {
    const v = typeof n === "number" && Number.isFinite(n) ? Math.round(n) : fallback;
    return Math.max(0, Math.min(100, v));
  };

  if (!raw || typeof raw !== "object") return d;
  const r = raw as Partial<KitchenConfig> & { stationCaps?: Partial<KitchenConfig["stationCaps"]>; thresholds?: Partial<KitchenThresholds> };

  const stationCaps: KitchenConfig["stationCaps"] = {
    grill:   capFloor(r.stationCaps?.grill,   d.stationCaps.grill),
    fryer:   capFloor(r.stationCaps?.fryer,   d.stationCaps.fryer),
    bar:     capFloor(r.stationCaps?.bar,     d.stationCaps.bar),
    dessert: capFloor(r.stationCaps?.dessert, d.stationCaps.dessert),
    cold:    capFloor(r.stationCaps?.cold,    d.stationCaps.cold),
    pasta:   capFloor(r.stationCaps?.pasta,   d.stationCaps.pasta),
  };

  let warn = pctClamp(r.thresholds?.warn, d.thresholds.warn);
  let critical = pctClamp(r.thresholds?.critical, d.thresholds.critical);
  // Enforce ordering: warn can't exceed critical. If the user inverted them,
  // snap warn down to critical so the UI color bands stay sensible.
  if (warn > critical) warn = critical;

  return {
    maxParallel: capFloor(r.maxParallel, d.maxParallel),
    stationCaps,
    thresholds: { warn, critical },
  };
}

// Single source of truth for the kitchen load percentage.
export function computeKitchenCapacity(activeOrders: number, config: KitchenConfig = DEFAULT_KITCHEN_CONFIG): number {
  const max = config.maxParallel > 0 ? config.maxParallel : 1;
  return Math.min(100, Math.round((activeOrders / max) * 100));
}
