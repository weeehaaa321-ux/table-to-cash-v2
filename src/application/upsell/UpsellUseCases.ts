// Server-side wrapper around the pure upsell ranker. Loads the menu,
// resolves the authoritative Cairo hour, gathers the guest's session
// context (cancellations, prior rounds), and hands the bundle to the
// pure scoring function.
//
// Lives behind /api/upsell. The cart UI just sends the cart line ids
// + sessionId; everything else is fetched here.

import { db } from "@/lib/db";
import { toNum } from "@/lib/money";
import { isStationAcceptingOrders } from "@/lib/shifts";
import { rankUpsells, type UpsellMenuItem, type UpsellCategory, type UpsellSuggestion } from "@/lib/upsell-engine";

export class UpsellUseCases {
  async resolveRestaurantId(id: string): Promise<string | null> {
    if (!id) return null;
    if (id.startsWith("c") && id.length > 10) return id;
    const r = await db.restaurant.findUnique({ where: { slug: id }, select: { id: true } });
    return r?.id || null;
  }

  /**
   * Rank upsells for a cart. Caller provides the cart's menu-item ids
   * (with quantities) and an optional sessionId to factor in prior
   * cancellations / paid rounds.
   */
  async suggestForCart(input: {
    restaurantId: string;
    cart: { menuItemId: string; quantity: number }[];
    sessionId?: string | null;
    /** Override the Cairo hour for testing — production callers omit. */
    cairoHour?: number;
  }): Promise<UpsellSuggestion[]> {
    const { restaurantId, cart, sessionId } = input;

    // Pull the live menu (same shape the guest UI sees, including
    // hour-windowed visibility — out-of-hours items won't be candidates).
    const categories = await db.category.findMany({
      where: { restaurantId },
      include: {
        items: {
          where: { available: true },
          include: { addOns: true },
        },
      },
    });

    // Cairo hour: same Intl helper the menu fetch uses, kept inline so
    // the use case doesn't acquire a hidden dep on shifts.ts. Lets a
    // test pin time deterministically via input.cairoHour.
    const cairoHour = input.cairoHour ?? parseInt(
      new Intl.DateTimeFormat("en-GB", {
        timeZone: "Africa/Cairo",
        hour: "2-digit",
        hour12: false,
      }).format(new Date()),
      10,
    );

    // Filter items whose own hour window has closed. Mirrors
    // getMenuForRestaurant's logic — keeps the engine from suggesting
    // a breakfast item at 4pm even though it's still in the menu.
    const inWindow = (from: number | null, to: number | null) => {
      if (from == null && to == null) return true;
      const f = from ?? 0;
      const t = to ?? 24;
      if (f <= t) return cairoHour >= f && cairoHour < t;
      return cairoHour >= f || cairoHour < t;
    };

    const upsellCategories: UpsellCategory[] = categories.map((c) => ({
      id: c.id,
      slug: c.slug,
      name: c.name,
      station: c.station as UpsellCategory["station"],
    }));

    const menu: UpsellMenuItem[] = [];
    for (const c of categories) {
      for (const it of c.items) {
        const itemFrom = it.availableFromHour ?? c.availableFromHour;
        const itemTo = it.availableToHour ?? c.availableToHour;
        if (!inWindow(itemFrom, itemTo)) continue;
        menu.push({
          id: it.id,
          name: it.name,
          nameAr: it.nameAr,
          price: toNum(it.price),
          pricePerHour: it.pricePerHour == null ? null : toNum(it.pricePerHour),
          image: it.image,
          available: it.available,
          bestSeller: it.bestSeller,
          highMargin: it.highMargin,
          tags: it.tags ?? [],
          pairsWith: it.pairsWith ?? [],
          categoryId: it.categoryId,
          station: c.station as UpsellMenuItem["station"],
        });
      }
    }

    // Hydrate cart lines from the menu we just loaded. Anything the
    // client thinks is in the cart but isn't on the live menu is
    // dropped silently — the menu is source of truth.
    const menuById = new Map(menu.map((m) => [m.id, m]));
    const cartLines = cart
      .map((c) => {
        const m = menuById.get(c.menuItemId);
        if (!m) return null;
        return { menuItem: m, quantity: c.quantity };
      })
      .filter((x): x is { menuItem: UpsellMenuItem; quantity: number } => !!x);

    // Session context: cancelled items + items already paid in prior
    // rounds. Both reduce the score for matching candidates so we
    // don't suggest what's already been ordered or rejected.
    let cancelledItemIds: string[] = [];
    let previouslyOrderedItemIds: string[] = [];
    if (sessionId) {
      const orders = await db.order.findMany({
        where: { sessionId },
        select: {
          paidAt: true,
          items: { select: { menuItemId: true, cancelled: true } },
        },
      });
      const cancelled = new Set<string>();
      const prior = new Set<string>();
      for (const o of orders) {
        for (const it of o.items) {
          if (!it.menuItemId) continue;
          if (it.cancelled) cancelled.add(it.menuItemId);
          if (o.paidAt) prior.add(it.menuItemId);
        }
      }
      cancelledItemIds = Array.from(cancelled);
      previouslyOrderedItemIds = Array.from(prior);
    }

    // Active stations: kitchen / bar coverage + activities (always
    // open). Prevents suggesting a kitchen item when the kitchen is
    // closed. Mirrors MenuReadUseCase.forRestaurant's logic but with
    // ACTIVITY in the mix.
    const stationStaff = await db.staff.findMany({
      where: { restaurantId, active: true, role: { in: ["KITCHEN", "BAR"] } },
      select: { role: true, shift: true },
    });
    const kitchenShifts = stationStaff.filter((s) => s.role === "KITCHEN").map((s) => s.shift);
    const barShifts = stationStaff.filter((s) => s.role === "BAR").map((s) => s.shift);
    const activeStations: ("KITCHEN" | "BAR" | "ACTIVITY")[] = [];
    if (isStationAcceptingOrders("KITCHEN", kitchenShifts)) activeStations.push("KITCHEN");
    if (isStationAcceptingOrders("BAR", barShifts)) activeStations.push("BAR");
    activeStations.push("ACTIVITY");

    const dayOfWeek = parseInt(
      new Intl.DateTimeFormat("en-GB", {
        timeZone: "Africa/Cairo",
        weekday: "short",
      }).format(new Date()) === "Sun" ? "0" : "1", // weekday formatter quirk; not used downstream so a coarse value is fine
      10,
    );

    return rankUpsells({
      cart: cartLines,
      menu,
      categories: upsellCategories,
      cairoHour,
      dayOfWeek,
      cancelledItemIds,
      previouslyOrderedItemIds,
      activeStations,
    });
  }
}
