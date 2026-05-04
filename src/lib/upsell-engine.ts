// ═══════════════════════════════════════════════════════════════════
// SMART UPSELL ENGINE
//
// Pure scoring function. No DB / no fetch / no React. Caller fetches
// the menu + cart + cancellation history, hands them in, gets ranked
// suggestions back. That structure means:
//   - It runs identically client-side, server-side, or in tests.
//   - Future ML re-ranker plugs in by replacing scoreCandidate.
//   - Tuning the weights is one file edit.
//
// Replaces the older 9-rule client-side ranker that lived inside
// cart/page.tsx. The big differences:
//   - Multi-signal scoring instead of first-match rules → no ordering
//     bug where rule N's match starves rule M.
//   - Authoritative Cairo hour from the caller, not browser local time.
//   - Honours `MenuItem.pairsWith` (operator-curated pairings) as the
//     highest-priority signal.
//   - AOV-aware: a 200 EGP cart never gets pushed a 1500 EGP item.
//   - Activity-aware: pool/kayak/board/massage have their own time
//     windows and only surface against the right cart context.
//   - Skips items recently cancelled in the same session.
// ═══════════════════════════════════════════════════════════════════

export type UpsellMenuItem = {
  id: string;
  name: string;
  nameAr?: string | null;
  price: number;
  pricePerHour?: number | null;
  image?: string | null;
  available: boolean;
  bestSeller: boolean;
  highMargin: boolean;
  tags: string[];
  pairsWith: string[];
  categoryId: string;
  station?: "KITCHEN" | "BAR" | "ACTIVITY";
};

export type UpsellCategory = {
  id: string;
  slug: string;
  name: string;
  station?: "KITCHEN" | "BAR" | "ACTIVITY";
};

export type UpsellCartLine = {
  menuItem: UpsellMenuItem;
  quantity: number;
};

export type UpsellContext = {
  cart: UpsellCartLine[];
  menu: UpsellMenuItem[];
  categories: UpsellCategory[];
  /** Authoritative Cairo hour (0-23). Caller fetches this — pure module
   * stays untainted by Date.now() so tests pin time. */
  cairoHour: number;
  /** 0 = Sunday, 6 = Saturday. Used for weekend tilts. */
  dayOfWeek: number;
  /** Menu-item ids the guest cancelled inside this session. We don't
   * re-suggest a thing they already explicitly removed. */
  cancelledItemIds?: string[];
  /** Items that already paid in a prior round (round 2+). Keeps us
   * from suggesting a third coffee when they already had two. */
  previouslyOrderedItemIds?: string[];
  /** Activity stations that are open for orders. When the caller knows
   * an item's station is gated off, it should pre-filter — but this is
   * a belt-and-braces signal so the engine refuses to rank an unbookable
   * item even if the menu list still includes it. */
  activeStations?: ("KITCHEN" | "BAR" | "ACTIVITY")[];
};

export type UpsellSuggestion = {
  itemId: string;
  /** The score that won. Returned so analytics can correlate
   * "high-confidence vs marginal" suggestions later. */
  score: number;
  /** Single line: the headline copy ("Coffee with breakfast?"). */
  reason: string;
  /** One-line under the headline ("Freshly brewed, made to order"). */
  subtext: string;
  /** Tag the picker used so the cart page can color-code or filter
   * (e.g. activity suggestions might get a different chip). */
  bucket: "drink" | "starter" | "side" | "dessert" | "main" | "activity" | "other";
};

// ─── Tags ────────────────────────────────────────────────────────────
// The menu uses tags loosely — operators tag with "drink"/"juice"/etc.
// ad-hoc. We treat tag matches as soft signals and cross-check by
// category name where it matters (pizza/pasta/burger).

const DRINK_TAGS = ["drink", "cocktail", "wine", "beer", "juice", "coffee", "tea", "smoothie", "soda"];
const HOT_DRINK_TAGS = ["coffee", "tea", "hot"];
const COLD_DRINK_TAGS = ["juice", "smoothie", "soda", "iced"];
const STARTER_TAGS = ["appetizer", "starter", "sharing", "snack"];
const DESSERT_TAGS = ["dessert", "sweet", "pastry", "cake", "ice-cream"];
const MAIN_TAGS = ["main", "entree"];
const BREAKFAST_TAGS = ["breakfast"];

function hasAnyTag(item: UpsellMenuItem, tags: string[]): boolean {
  if (!item.tags) return false;
  for (const t of tags) if (item.tags.includes(t)) return true;
  return false;
}
function hasTag(item: UpsellMenuItem, tag: string): boolean {
  return Array.isArray(item.tags) && item.tags.includes(tag);
}

function categoryNameLower(item: UpsellMenuItem, categories: UpsellCategory[]): string {
  const c = categories.find((cc) => cc.id === item.categoryId);
  return (c?.name || c?.slug || "").toLowerCase();
}

function bucketFor(item: UpsellMenuItem, categories: UpsellCategory[]): UpsellSuggestion["bucket"] {
  if (item.station === "ACTIVITY") return "activity";
  if (hasAnyTag(item, DESSERT_TAGS)) return "dessert";
  if (hasAnyTag(item, DRINK_TAGS)) return "drink";
  if (hasAnyTag(item, STARTER_TAGS)) return "starter";
  if (hasAnyTag(item, MAIN_TAGS)) return "main";
  const cat = categoryNameLower(item, categories);
  if (cat.includes("salad") || cat.includes("soup")) return "side";
  return "other";
}

// ─── Time-of-day windows (Cairo hours) ───────────────────────────────
// Inclusive lower, exclusive upper. Wraparound handled via the helper.

function inHourRange(hour: number, from: number, to: number): boolean {
  if (from <= to) return hour >= from && hour < to;
  return hour >= from || hour < to;
}

function isMorning(h: number)   { return inHourRange(h, 6, 11); }
function isLunch(h: number)     { return inHourRange(h, 11, 15); }
function isAfternoon(h: number) { return inHourRange(h, 15, 18); }
function isEvening(h: number)   { return inHourRange(h, 18, 22); }
function isLateNight(h: number) { return inHourRange(h, 22, 6); }

// ─── Helpers ─────────────────────────────────────────────────────────

function cartTotal(cart: UpsellCartLine[]): number {
  return cart.reduce((s, c) => s + c.menuItem.price * c.quantity, 0);
}

function avgItemPrice(cart: UpsellCartLine[]): number {
  if (cart.length === 0) return 0;
  return cartTotal(cart) / cart.reduce((s, c) => s + c.quantity, 0);
}

function cartHasBucket(cart: UpsellCartLine[], categories: UpsellCategory[], bucket: UpsellSuggestion["bucket"]): boolean {
  return cart.some((c) => bucketFor(c.menuItem, categories) === bucket);
}

// ─── Scoring ─────────────────────────────────────────────────────────

type ScoreBreakdown = {
  score: number;
  reasons: { tag: string; weight: number }[];
};

function scoreCandidate(
  candidate: UpsellMenuItem,
  ctx: UpsellContext,
  cartIds: Set<string>,
): ScoreBreakdown | null {
  const { cart, categories, cairoHour, cancelledItemIds = [], previouslyOrderedItemIds = [] } = ctx;
  const reasons: { tag: string; weight: number }[] = [];
  let score = 0;

  // Hard filters ───────────────────────────────────────────────────
  if (!candidate.available) return null;
  if (cartIds.has(candidate.id)) return null;
  if (cancelledItemIds.includes(candidate.id)) return null;
  if (ctx.activeStations && candidate.station && !ctx.activeStations.includes(candidate.station)) {
    return null;
  }

  const bucket = bucketFor(candidate, categories);
  const total = cartTotal(cart);
  const avg = avgItemPrice(cart);

  // ── 1. pairsWith — operator-curated, gold standard ──────────────
  // If ANY cart item lists this candidate in pairsWith, that's an
  // explicit "we recommend this combo" from the menu admin. Heavily
  // weighted so it almost always wins ties.
  const pairedWithCart = cart.some((c) =>
    Array.isArray(c.menuItem.pairsWith) && c.menuItem.pairsWith.includes(candidate.id),
  );
  if (pairedWithCart) {
    score += 50;
    reasons.push({ tag: "pairs-with", weight: 50 });
  }

  // ── 2. Category gap fills ───────────────────────────────────────
  // What's the natural progression? main → drink → starter → dessert.
  // We weight gap fills heavily because that's what a waiter would
  // notice first.
  const hasMain = cartHasBucket(cart, categories, "main");
  const hasDrink = cartHasBucket(cart, categories, "drink");
  const hasStarter = cartHasBucket(cart, categories, "starter");
  const hasDessert = cartHasBucket(cart, categories, "dessert");

  if (bucket === "drink" && hasMain && !hasDrink) {
    score += 40;
    reasons.push({ tag: "gap-drink", weight: 40 });
  }
  if (bucket === "starter" && hasMain && !hasStarter && cart.length >= 1) {
    score += 30;
    reasons.push({ tag: "gap-starter", weight: 30 });
  }
  if (bucket === "dessert" && cart.length >= 2 && !hasDessert) {
    score += 25;
    reasons.push({ tag: "gap-dessert", weight: 25 });
  }
  // Drinks-only cart → push a snack hard.
  if (bucket === "starter" && cart.length >= 1 && cart.every((c) => hasAnyTag(c.menuItem, DRINK_TAGS))) {
    score += 35;
    reasons.push({ tag: "drinks-only-needs-bite", weight: 35 });
  }

  // ── 3. Time-of-day boosts ───────────────────────────────────────
  if (isMorning(cairoHour)) {
    if (hasAnyTag(candidate, ["coffee", "tea"])) { score += 22; reasons.push({ tag: "morning-coffee", weight: 22 }); }
    if (hasAnyTag(candidate, ["juice", "smoothie"])) { score += 20; reasons.push({ tag: "morning-juice", weight: 20 }); }
    if (hasAnyTag(candidate, BREAKFAST_TAGS)) { score += 18; reasons.push({ tag: "morning-breakfast", weight: 18 }); }
  } else if (isLunch(cairoHour)) {
    if (categoryNameLower(candidate, categories).includes("salad")) { score += 12; reasons.push({ tag: "lunch-salad", weight: 12 }); }
    if (hasAnyTag(candidate, COLD_DRINK_TAGS)) { score += 10; reasons.push({ tag: "lunch-cold-drink", weight: 10 }); }
  } else if (isAfternoon(cairoHour)) {
    if (bucket === "activity" && hasTag(candidate, "pool")) { score += 25; reasons.push({ tag: "afternoon-pool", weight: 25 }); }
    if (hasAnyTag(candidate, COLD_DRINK_TAGS)) { score += 12; reasons.push({ tag: "afternoon-cold", weight: 12 }); }
    if (hasAnyTag(candidate, ["ice-cream", "smoothie"])) { score += 14; reasons.push({ tag: "afternoon-cool", weight: 14 }); }
  } else if (isEvening(cairoHour)) {
    if (hasAnyTag(candidate, ["cocktail", "wine", "beer"])) { score += 22; reasons.push({ tag: "evening-cocktail", weight: 22 }); }
    if (bucket === "main" && !hasMain) { score += 15; reasons.push({ tag: "evening-main", weight: 15 }); }
    if (hasAnyTag(candidate, DESSERT_TAGS)) { score += 12; reasons.push({ tag: "evening-dessert", weight: 12 }); }
  } else if (isLateNight(cairoHour)) {
    if (hasAnyTag(candidate, ["dessert", "sweet", "coffee"])) { score += 15; reasons.push({ tag: "late-light", weight: 15 }); }
    // Suppress heavy mains late.
    if (bucket === "main") { score -= 10; reasons.push({ tag: "late-no-main", weight: -10 }); }
  }

  // ── 4. AOV-aware price match ────────────────────────────────────
  // Don't push a 1500 EGP massage at a 200 EGP cart, and don't push a
  // 50 EGP side at a 1200 EGP table — both miss tonally.
  if (total > 0) {
    if (total < 200 && candidate.price > 250) {
      score -= 25;
      reasons.push({ tag: "too-expensive", weight: -25 });
    } else if (total < 200 && candidate.price <= 150) {
      score += 12;
      reasons.push({ tag: "price-fits-small", weight: 12 });
    } else if (total >= 200 && total < 500 && candidate.price >= 80 && candidate.price <= 350) {
      score += 8;
      reasons.push({ tag: "price-fits-mid", weight: 8 });
    } else if (total >= 500 && candidate.price >= 200 && candidate.price <= 800) {
      score += 12;
      reasons.push({ tag: "price-fits-premium", weight: 12 });
    }
    // Ratio sanity: candidate > 3× avg item is almost always wrong unless
    // pairsWith said otherwise.
    if (avg > 0 && candidate.price > avg * 4 && !pairedWithCart) {
      score -= 20;
      reasons.push({ tag: "price-ratio-off", weight: -20 });
    }
  }

  // ── 5. Activity-specific gating ─────────────────────────────────
  // Activities only fit certain contexts — we don't shove a kayak at
  // someone who hasn't even picked food.
  if (bucket === "activity") {
    const hasFood = cart.some((c) => c.menuItem.station === "KITCHEN");
    const hasAnyCart = cart.length > 0;
    if (!hasAnyCart) {
      // Empty cart → no activities; let them pick food first.
      score -= 40;
      reasons.push({ tag: "activity-empty-cart", weight: -40 });
    }
    if (isLateNight(cairoHour) || isEvening(cairoHour)) {
      // No daytime activities at night, except massage (the spa-night case).
      if (!hasTag(candidate, "massage")) {
        score -= 30;
        reasons.push({ tag: "activity-not-daylight", weight: -30 });
      } else {
        score += 12;
        reasons.push({ tag: "evening-massage", weight: 12 });
      }
    }
    if (isAfternoon(cairoHour) && hasFood) {
      score += 18;
      reasons.push({ tag: "post-lunch-activity", weight: 18 });
    }
    // Massage is the rare flat-priced premium add — bias toward it
    // when cart total is generous.
    if (hasTag(candidate, "massage") && total >= 300) {
      score += 10;
      reasons.push({ tag: "premium-cart-spa", weight: 10 });
    }
  }

  // ── 6. Best-seller / high-margin tilts ──────────────────────────
  if (candidate.bestSeller) { score += 14; reasons.push({ tag: "best-seller", weight: 14 }); }
  if (candidate.highMargin) { score += 8;  reasons.push({ tag: "high-margin", weight: 8  }); }

  // ── 7. Don't repeat what they already had ───────────────────────
  if (previouslyOrderedItemIds.includes(candidate.id)) {
    score -= 15;
    reasons.push({ tag: "already-had", weight: -15 });
  }

  // ── 8. Same-bucket saturation ───────────────────────────────────
  // If the cart already has 2+ drinks, a third drink is unlikely to
  // delight. Mild penalty so the engine prefers a different category.
  const sameBucketCount = cart.filter((c) => bucketFor(c.menuItem, categories) === bucket).length;
  if (sameBucketCount >= 2) {
    score -= 18;
    reasons.push({ tag: "bucket-saturated", weight: -18 });
  }

  // Floor at 0 — items that score negative everywhere shouldn't surface.
  if (score <= 0) return null;
  return { score, reasons };
}

// ─── Copy generation ─────────────────────────────────────────────────
// Maps the dominant scoring tag to natural-feeling copy. The cart UI
// just renders { reason, subtext } verbatim, so all phrasing decisions
// concentrate here.

type Copy = { reason: string; subtext: string };

function craftCopy(
  candidate: UpsellMenuItem,
  reasons: { tag: string; weight: number }[],
  ctx: UpsellContext,
  bucket: UpsellSuggestion["bucket"],
): Copy {
  // The strongest reason drives copy. If two tie, pairs-with wins.
  const sorted = [...reasons].sort((a, b) => {
    if (a.tag === "pairs-with") return -1;
    if (b.tag === "pairs-with") return 1;
    return b.weight - a.weight;
  });
  const top = sorted[0]?.tag || "";
  const total = cartTotal(ctx.cart);

  // pairsWith hits get a personalised line referencing the cart item.
  if (top === "pairs-with") {
    const pairedCartItem = ctx.cart.find((c) =>
      Array.isArray(c.menuItem.pairsWith) && c.menuItem.pairsWith.includes(candidate.id),
    );
    if (pairedCartItem) {
      return {
        reason: `Pairs with your ${pairedCartItem.menuItem.name}`,
        subtext: candidate.bestSeller ? "Most-loved combo on the menu" : "Chef-recommended pairing",
      };
    }
  }

  // Time-of-day signature lines.
  switch (top) {
    case "morning-coffee":
      return { reason: "Coffee to start the morning?", subtext: "Freshly brewed, made your way" };
    case "morning-juice":
      return { reason: "Cold-pressed juice?", subtext: "Made to order — perfect with breakfast" };
    case "morning-breakfast":
      return { reason: "Add this to your breakfast", subtext: "Most ordered before noon" };
    case "lunch-salad":
      return { reason: "Balance the meal with a salad", subtext: "Fresh, light, ready in minutes" };
    case "lunch-cold-drink":
      return { reason: "Cool down with a cold drink", subtext: "Beat the lunchtime heat" };
    case "afternoon-pool":
      return { reason: "Pool ticket for the afternoon?", subtext: "Sun's still up — make a day of it" };
    case "afternoon-cold":
      return { reason: "Something cold for the heat?", subtext: "Iced and ready" };
    case "afternoon-cool":
      return { reason: "Sweet and cool", subtext: "The afternoon classic" };
    case "evening-cocktail":
      return { reason: "Sundowner cocktail?", subtext: "Tonight's bar-side pick" };
    case "evening-main":
      return { reason: "Make it a meal", subtext: "Most popular dish this evening" };
    case "evening-dessert":
      return { reason: "End on a sweet note", subtext: "Tonight's signature dessert" };
    case "late-light":
      return { reason: "Something light to finish?", subtext: "Easy on a late hour" };
    case "post-lunch-activity":
      return {
        reason: candidate.pricePerHour
          ? `${candidate.name} — only pay for the hour you use`
          : `${candidate.name} — perfect after lunch`,
        subtext: candidate.pricePerHour
          ? `${candidate.pricePerHour} EGP/hr · stops when you do`
          : "Sun's still high",
      };
    case "evening-massage":
      return { reason: "Massage to wind the day down?", subtext: "Hour-long session, by appointment" };
    case "gap-drink":
      return { reason: "Pair it with a drink", subtext: "Most guests add one" };
    case "gap-starter":
      return { reason: "Start with this while you wait", subtext: "Out before your main" };
    case "gap-dessert":
      return { reason: "Save room for dessert?", subtext: "Tonight's most-loved finish" };
    case "drinks-only-needs-bite":
      return { reason: "Something to nibble on?", subtext: "Quick, sharable, our guests' favourite" };
    case "best-seller":
      return { reason: `Today's best-seller`, subtext: "Most ordered in the past hour" };
    case "high-margin":
      return { reason: "Try the kitchen's pick", subtext: "Crafted in-house" };
    case "premium-cart-spa":
      return { reason: "Round it off with a massage", subtext: "Hour-long, by appointment" };
  }

  // Generic fallbacks by bucket.
  switch (bucket) {
    case "drink":   return { reason: "Add a drink",   subtext: "Most guests do" };
    case "starter": return { reason: "Add a starter", subtext: "Comes out before your mains" };
    case "dessert": return { reason: "Try a dessert", subtext: "End on a sweet note" };
    case "side":    return { reason: "Add a side",    subtext: "Rounds out the table" };
    case "activity":
      return candidate.pricePerHour
        ? { reason: `${candidate.name}`, subtext: `${candidate.pricePerHour} EGP/hr · pay only for what you use` }
        : { reason: `${candidate.name}`, subtext: `${candidate.price} EGP — single ticket` };
    default:
      // If total is zero (empty cart, no rules fired) we don't even get
      // here — the engine returns no suggestions. So this is the rare
      // "we know nothing useful" path.
      return total > 0
        ? { reason: "You might like this", subtext: candidate.bestSeller ? "A guest favourite" : "Try it" }
        : { reason: "A guest favourite", subtext: "Most ordered today" };
  }
}

// ─── Main entry point ────────────────────────────────────────────────

export function rankUpsells(ctx: UpsellContext, max = 3): UpsellSuggestion[] {
  const cartIds = new Set(ctx.cart.map((c) => c.menuItem.id));
  const scored: { candidate: UpsellMenuItem; score: number; reasons: { tag: string; weight: number }[]; bucket: UpsellSuggestion["bucket"] }[] = [];

  for (const candidate of ctx.menu) {
    const breakdown = scoreCandidate(candidate, ctx, cartIds);
    if (!breakdown) continue;
    scored.push({
      candidate,
      score: breakdown.score,
      reasons: breakdown.reasons,
      bucket: bucketFor(candidate, ctx.categories),
    });
  }

  scored.sort((a, b) => b.score - a.score);

  // De-dup by bucket so we don't surface 3 drinks. At most one
  // suggestion per bucket unless we're clearly out of buckets to fill.
  const out: UpsellSuggestion[] = [];
  const usedBuckets = new Set<string>();
  for (const s of scored) {
    if (out.length >= max) break;
    if (usedBuckets.has(s.bucket)) continue;
    const copy = craftCopy(s.candidate, s.reasons, ctx, s.bucket);
    out.push({
      itemId: s.candidate.id,
      score: s.score,
      reason: copy.reason,
      subtext: copy.subtext,
      bucket: s.bucket,
    });
    usedBuckets.add(s.bucket);
  }
  // If we still have room and the cart is empty / very small, fill
  // with the next-best regardless of bucket repeats. The "show 3
  // suggestions" promise on the cart UI matters more than bucket purity
  // when the menu is small.
  if (out.length < max) {
    for (const s of scored) {
      if (out.length >= max) break;
      if (out.find((o) => o.itemId === s.candidate.id)) continue;
      const copy = craftCopy(s.candidate, s.reasons, ctx, s.bucket);
      out.push({
        itemId: s.candidate.id,
        score: s.score,
        reason: copy.reason,
        subtext: copy.subtext,
        bucket: s.bucket,
      });
    }
  }

  return out;
}
