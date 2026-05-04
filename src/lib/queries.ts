import { db } from "./db";
import { DELIVERY_FEE } from "./restaurant-config";
import { toNum } from "./money";

/**
 * Thrown by createOrder when the in-transaction session-status
 * re-read finds the session is gone or already CLOSED. Caller
 * (the orders POST route) translates this into 409 SESSION_CLOSED
 * so the guest's UI can prompt them to rescan.
 */
export class SessionClosedError extends Error {
  code: "SESSION_NOT_FOUND" | "SESSION_CLOSED";
  constructor(code: "SESSION_NOT_FOUND" | "SESSION_CLOSED") {
    super(code);
    this.code = code;
  }
}

// ─── Menu ────────────────────────────────────────

export async function getMenuForRestaurant(restaurantId: string) {
  const categories = await db.category.findMany({
    where: { restaurantId },
    orderBy: { sortOrder: "asc" },
    include: {
      items: {
        where: { available: true },
        orderBy: { sortOrder: "asc" },
        include: { addOns: true },
      },
    },
  });

  // Cairo local hour for time-of-day filtering. en-GB gives 0-23.
  const cairoHour = parseInt(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Africa/Cairo",
      hour: "2-digit",
      hour12: false,
    }).format(new Date()),
    10
  );
  const inWindow = (from: number | null, to: number | null) => {
    if (from == null && to == null) return true;
    const f = from ?? 0;
    const t = to ?? 24;
    // Allow wraparound (e.g. late-night menu 22-3) just in case
    if (f <= t) return cairoHour >= f && cairoHour < t;
    return cairoHour >= f || cairoHour < t;
  };

  return categories.map((cat) => ({
    id: cat.id,
    name: cat.name,
    nameAr: cat.nameAr,
    nameRu: cat.nameRu,
    slug: cat.slug,
    sortOrder: cat.sortOrder,
    icon: cat.icon,
    station: cat.station,
    // Items inherit the category's time window unless they set their own.
    // Item-level hours always win when present; otherwise fall back to
    // category hours. Keeps the "breakfast" bulk-hide working with one
    // edit at the category level, while still allowing per-item tweaks
    // (e.g. a single all-day item inside a time-limited category).
    items: cat.items
      .filter((item) => {
        const from = item.availableFromHour ?? cat.availableFromHour;
        const to = item.availableToHour ?? cat.availableToHour;
        return inWindow(from, to);
      })
      .map((item) => ({
      id: item.id,
      name: item.name,
      nameAr: item.nameAr,
      nameRu: item.nameRu,
      description: item.description,
      descAr: item.descAr,
      descRu: item.descRu,
      price: toNum(item.price),
      // Activity items use this rate alongside the OrderItem timer to
      // compute prorated billing. null for ordinary food/drinks AND
      // for flat-priced activities (pool ticket).
      pricePerHour: item.pricePerHour == null ? null : toNum(item.pricePerHour),
      image: item.image,
      available: item.available,
      bestSeller: item.bestSeller,
      highMargin: item.highMargin,
      calories: item.calories,
      prepTime: item.prepTime,
      sortOrder: item.sortOrder,
      categoryId: item.categoryId,
      pairsWith: item.pairsWith,
      tags: item.tags,
      views: item.views,
      addOns: item.addOns.map((a) => ({
        id: a.id,
        name: a.name,
        price: toNum(a.price),
      })),
    })),
  }));
}

// ─── Orders ──────────────────────────────────────

export async function createOrder(data: {
  restaurantId: string;
  tableId?: string | null;
  sessionId?: string;
  items: {
    menuItemId: string;
    quantity: number;
    price: number;
    addOns: string[];
    wasUpsell: boolean;
    notes?: string;
  }[];
  subtotal: number;
  total: number;
  tip?: number;
  paymentMethod?: string;
  language?: string;
  notes?: string;
  guestNumber?: number;
  guestName?: string;
  clientRequestId?: string;
  orderType?: string;
  vipGuestId?: string;
  deliveryAddress?: string;
  deliveryLat?: number;
  deliveryLng?: number;
  deliveryNotes?: string;
}) {
  // Idempotency: if the caller supplied a clientRequestId and we've already
  // persisted an order for it, return the existing bundle instead of
  // writing a duplicate. This covers the guest's phone retrying a POST
  // after a flaky network — the first write succeeded, the client just
  // didn't see the 201.
  if (data.clientRequestId) {
    const existing = await db.order.findUnique({
      where: { clientRequestId: data.clientRequestId },
      include: {
        items: { include: { menuItem: { select: { name: true, image: true } } } },
        table: { select: { number: true } },
      },
    });
    if (existing) {
      const siblings = existing.groupId
        ? await db.order.findMany({
            where: { groupId: existing.groupId },
            include: {
              items: { include: { menuItem: { select: { name: true, image: true } } } },
              table: { select: { number: true } },
            },
          })
        : [existing];
      const mergedItems = siblings.flatMap((row) =>
        row.items.map((oi) => ({
          menuItem: { name: oi.menuItem?.name ?? "Deleted item", image: oi.menuItem?.image ?? null },
          quantity: oi.quantity,
          price: toNum(oi.price),
        }))
      );
      const mergedTotal = siblings.reduce((s, r) => s + toNum(r.total), 0);
      return {
        id: existing.id,
        orderNumber: existing.orderNumber,
        status: existing.status,
        tableNumber: existing.table?.number ?? null,
        items: mergedItems,
        total: mergedTotal,
        guestNumber: existing.guestNumber,
        guestName: existing.guestName ?? null,
        createdAt: existing.createdAt.toISOString(),
        groupId: existing.groupId,
      };
    }
  }

  // Look up each menu item's category station so we can split a mixed
  // cart into one kitchen sub-order and one bar sub-order. Guests still
  // see a single unified order on /track — the split is staff-only.
  const menuItems = await db.menuItem.findMany({
    where: { id: { in: data.items.map((i) => i.menuItemId) } },
    select: { id: true, price: true, category: { select: { station: true } } },
  });
  const stationById = new Map<string, "KITCHEN" | "BAR" | "ACTIVITY">();
  const priceById = new Map<string, number>();
  for (const m of menuItems) {
    stationById.set(m.id, m.category.station);
    priceById.set(m.id, toNum(m.price));
  }
  const resolveStation = (id: string): "KITCHEN" | "BAR" | "ACTIVITY" =>
    stationById.get(id) ?? "KITCHEN";

  // Enforce server-side prices — ignore client-supplied prices to prevent
  // manipulation via stale menus or tampered requests.
  for (const item of data.items) {
    const serverPrice = priceById.get(item.menuItemId);
    if (serverPrice !== undefined) {
      item.price = serverPrice;
    }
  }

  // Partition items across three station buckets. ACTIVITY orders are
  // peeled off into their own Order row so they bypass kitchen / bar
  // prep screens and so their per-hour timer fields land on a single
  // row (mixing them into the kitchen bucket would tag activity items
  // with station=KITCHEN and surface them on the prep screen by
  // mistake).
  const kitchenItems = data.items.filter((i) => resolveStation(i.menuItemId) === "KITCHEN");
  const barItems = data.items.filter((i) => resolveStation(i.menuItemId) === "BAR");
  const activityItems = data.items.filter((i) => resolveStation(i.menuItemId) === "ACTIVITY");
  const distinctStations = [
    kitchenItems.length > 0 ? 1 : 0,
    barItems.length > 0 ? 1 : 0,
    activityItems.length > 0 ? 1 : 0,
  ].reduce((a, b) => a + b, 0);
  const isSplit = distinctStations > 1;
  const groupId = isSplit ? `grp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}` : null;

  const sumItems = (items: typeof data.items) =>
    items.reduce((s, i) => s + i.price * i.quantity, 0);

  const buckets: {
    station: "KITCHEN" | "BAR" | "ACTIVITY";
    items: typeof data.items;
    subtotal: number;
    total: number;
  }[] = [];
  // For DELIVERY orders, the delivery fee is added once to the first
  // bucket (kitchen if split, otherwise the only bucket). Persisting
  // it in Order.total — instead of the previous UI-only +50 — means
  // the kitchen receipt, cashier ledger, drawer expectedCash, and
  // daily-close totals all reconcile to the same number.
  const isDelivery = data.orderType === "DELIVERY";
  const deliveryFee = isDelivery ? DELIVERY_FEE : 0;

  if (isSplit) {
    // Fee rides on whichever bucket lands first. Activity-only orders
    // shouldn't ever combine with delivery (no deliverable activity)
    // but the math stays consistent if it ever does.
    let feeApplied = false;
    if (kitchenItems.length > 0) {
      const sub = sumItems(kitchenItems);
      const fee = !feeApplied ? deliveryFee : 0;
      buckets.push({ station: "KITCHEN", items: kitchenItems, subtotal: sub, total: sub + fee });
      feeApplied = true;
    }
    if (barItems.length > 0) {
      const sub = sumItems(barItems);
      const fee = !feeApplied ? deliveryFee : 0;
      buckets.push({ station: "BAR", items: barItems, subtotal: sub, total: sub + fee });
      feeApplied = true;
    }
    if (activityItems.length > 0) {
      const sub = sumItems(activityItems);
      const fee = !feeApplied ? deliveryFee : 0;
      buckets.push({ station: "ACTIVITY", items: activityItems, subtotal: sub, total: sub + fee });
      feeApplied = true;
    }
  } else {
    // Recompute server-side from server-priced items. Trusting the
    // client's `data.subtotal`/`data.total` lets a tampered request pay
    // 1 EGP for a 400 EGP cart — the kitchen cooks the real items, the
    // cashier sees the fake total. The split branch above already does
    // this; the non-split branch must too.
    const station: "KITCHEN" | "BAR" | "ACTIVITY" =
      activityItems.length > 0 ? "ACTIVITY" : barItems.length > 0 ? "BAR" : "KITCHEN";
    const sub = sumItems(data.items);
    buckets.push({ station, items: data.items, subtotal: sub, total: sub + deliveryFee });
  }

  // Allocate orderNumber + write all sub-orders inside one transaction
  // so concurrent POSTs can't (a) read the same lastOrder and produce
  // duplicate orderNumbers, or (b) leave a split kitchen-only row
  // orphaned because the bar half failed.
  //
  // pg_advisory_xact_lock serialises only orders for *this* restaurant
  // — it doesn't block other restaurants. The lock is released when
  // the transaction ends, win or lose. hashtextextended hashes the
  // cuid into a 64-bit int for the lock key. Without this lock,
  // SERIALIZABLE isolation would also work but forces clients to
  // retry on conflict; the advisory lock just queues briefly.
  const created = await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${data.restaurantId}, 0))`;

    // Per-session lock (namespace 1). Pairs with confirmPayRound,
    // closeWithCancellations, changeTable, and maybeCloseSession so
    // a session close racing this order POST can't strand the new
    // order on a CLOSED session. The session-status re-read below
    // is the second half of that defense.
    if (data.sessionId) {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${data.sessionId}, 1))`;
      const sessionRow = await tx.tableSession.findUnique({
        where: { id: data.sessionId },
        select: { status: true },
      });
      if (!sessionRow) {
        throw new SessionClosedError("SESSION_NOT_FOUND");
      }
      if (sessionRow.status !== "OPEN") {
        throw new SessionClosedError("SESSION_CLOSED");
      }
    }

    const lastOrder = await tx.order.findFirst({
      where: { restaurantId: data.restaurantId },
      orderBy: { orderNumber: "desc" },
      select: { orderNumber: true },
    });
    const orderNumber = (lastOrder?.orderNumber ?? 1000) + 1;

    const rows = [];
    for (let i = 0; i < buckets.length; i++) {
      const bucket = buckets[i];
      // Delivery fee lives on the bucket that owns it (kitchen if split,
      // otherwise the only bucket). The bucket.total already includes
      // the fee so it doesn't need re-adding to total here.
      const bucketDeliveryFee =
        bucket.station === buckets[0].station ? deliveryFee : 0;
      const row = await tx.order.create({
        data: {
          orderNumber,
          restaurantId: data.restaurantId,
          ...(data.tableId ? { tableId: data.tableId } : {}),
          sessionId: data.sessionId || null,
          orderType: (data.orderType as never) || "TABLE",
          vipGuestId: data.vipGuestId || null,
          deliveryAddress: data.deliveryAddress || null,
          deliveryLat: data.deliveryLat ?? null,
          deliveryLng: data.deliveryLng ?? null,
          deliveryNotes: data.deliveryNotes || null,
          subtotal: Math.round(bucket.subtotal),
          total: Math.round(bucket.total),
          deliveryFee: bucketDeliveryFee,
          // Tip rides only on the first (kitchen) sub-order so it isn't
          // double-counted when the session total is computed.
          tip: bucket.station === buckets[0].station
            ? Math.round(Math.max(0, data.tip || 0))
            : 0,
          paymentMethod: data.paymentMethod as never,
          language: data.language || "en",
          notes: data.notes,
          guestNumber: data.guestNumber && data.guestNumber > 0 ? data.guestNumber : null,
          guestName: data.guestName && data.guestName.trim() ? data.guestName.trim().slice(0, 30) : null,
          station: bucket.station,
          groupId,
          // Only the first sub-order carries the idempotency key — split
          // siblings are discovered via groupId on retry lookups.
          clientRequestId: i === 0 ? (data.clientRequestId || null) : null,
          items: {
            create: bucket.items.map((item) => ({
              menuItemId: item.menuItemId,
              quantity: item.quantity,
              price: Math.round(item.price),
              addOns: item.addOns,
              wasUpsell: item.wasUpsell,
              notes: item.notes,
            })),
          },
        },
        include: {
          items: { include: { menuItem: { select: { name: true, image: true } } } },
          table: { select: { number: true } },
        },
      });
      rows.push(row);
    }
    return rows;
  });

  // Return the merged view so the caller (guest POST) still gets the
  // single-order shape it expects. Kitchen / bar pages fetch siblings
  // separately via getOrdersForRestaurant.
  const primary = created[0];
  const mergedItems = created.flatMap((row) =>
    row.items.map((oi) => ({
      menuItem: { name: oi.menuItem?.name ?? "Deleted item", image: oi.menuItem?.image ?? null },
      quantity: oi.quantity,
      price: toNum(oi.price),
    }))
  );
  const mergedTotal = created.reduce((s, r) => s + toNum(r.total), 0);

  return {
    id: primary.id,
    orderNumber: primary.orderNumber,
    status: primary.status,
    tableNumber: primary.table?.number ?? null,
    items: mergedItems,
    total: mergedTotal,
    guestNumber: primary.guestNumber,
    guestName: primary.guestName ?? null,
    createdAt: primary.createdAt.toISOString(),
    groupId,
  };
}

export async function getOrdersForRestaurant(
  restaurantId: string,
  opts?: { station?: "KITCHEN" | "BAR" }
) {
  // Explicit `select` on items — this route polls every few seconds from
  // every staff tablet, so a schema-drift mismatch (e.g. a new column in
  // OrderItem that prod hasn't migrated yet) would 500 the live dashboard
  // for the whole restaurant. Naming the columns we actually use keeps
  // the query stable across migrations.
  const orders = await db.order.findMany({
    where: {
      restaurantId,
      ...(opts?.station ? { station: opts.station } : {}),
    },
    orderBy: { createdAt: "desc" },
    include: {
      items: {
        select: {
          id: true,
          menuItemId: true,
          quantity: true,
          price: true,
          wasUpsell: true,
          notes: true,
          cancelled: true,
          cancelReason: true,
          menuItem: { select: { name: true, image: true, prepTime: true, tags: true } },
        },
      },
      table: { select: { number: true } },
      vipGuest: { select: { name: true } },
    },
    take: 50,
  });

  return orders.map((o) => ({
    id: o.id,
    orderNumber: o.orderNumber,
    status: o.status,
    tableNumber: o.table?.number ?? null,
    sessionId: o.sessionId || null,
    paymentMethod: o.paymentMethod || null,
    notes: o.notes || null,
    station: o.station,
    groupId: o.groupId || null,
    orderType: o.orderType,
    vipGuestName: o.vipGuest?.name ?? null,
    guestNumber: o.guestNumber ?? null,
    guestName: o.guestName ?? null,
    deliveryStatus: o.deliveryStatus ?? null,
    readyAt: o.readyAt ? o.readyAt.toISOString() : null,
    servedAt: o.servedAt ? o.servedAt.toISOString() : null,
    items: o.items.map((oi) => ({
      id: oi.id,
      menuItemId: oi.menuItemId,
      name: oi.menuItem?.name ?? "Deleted item",
      quantity: oi.quantity,
      price: toNum(oi.price),
      wasUpsell: oi.wasUpsell,
      prepTime: oi.menuItem?.prepTime ?? 0,
      tags: oi.menuItem?.tags ?? [],
      notes: oi.notes || null,
      cancelled: oi.cancelled,
      cancelReason: oi.cancelReason || null,
    })),
    total: toNum(o.total),
    deliveryFee: toNum(o.deliveryFee),
    createdAt: o.createdAt.toISOString(),
    updatedAt: o.updatedAt.toISOString(),
  }));
}

export async function getOrdersForSession(sessionId: string) {
  const orders = await db.order.findMany({
    where: { sessionId },
    orderBy: { createdAt: "asc" },
    include: {
      // Explicit select on items so adding nullable columns to OrderItem
      // (comp tracking, etc.) in a later migration can't break this read
      // before prod's DB has the new columns. Pre-deploy schema drift
      // showed up as 500s on /api/live-snapshot — never again.
      items: {
        select: {
          id: true,
          menuItemId: true,
          quantity: true,
          price: true,
          wasUpsell: true,
          notes: true,
          cancelled: true,
          cancelReason: true,
          menuItem: { select: { name: true, image: true, prepTime: true } },
        },
      },
      table: { select: { number: true } },
    },
  });

  return orders.map((o) => ({
    id: o.id,
    orderNumber: o.orderNumber,
    status: o.status,
    tableNumber: o.table?.number ?? null,
    station: o.station,
    groupId: o.groupId || null,
    guestNumber: o.guestNumber ?? null,
    guestName: o.guestName ?? null,
    notes: o.notes || null,
    items: o.items.map((oi) => ({
      id: oi.id,
      menuItemId: oi.menuItemId,
      name: oi.menuItem?.name ?? "Deleted item",
      quantity: oi.quantity,
      price: toNum(oi.price),
      wasUpsell: oi.wasUpsell,
      notes: oi.notes || null,
      cancelled: oi.cancelled,
      cancelReason: oi.cancelReason || null,
    })),
    total: toNum(o.total),
    createdAt: o.createdAt.toISOString(),
  }));
}

// Allowed prior statuses for each target. Acts as a state-machine
// guard so a stale/queued PATCH on a flaky tablet can't, say, flip a
// CANCELLED order back to READY (kitchen offline at cancel time, its
// queued "ready" arrives 5 s later — we don't want food cooked
// against a row the floor manager already voided).
//
// PAID accepts any pre-PAID/pre-CANCELLED state so the cashier-walk-up
// case (confirm before food is served) keeps working. CANCELLED can
// fire from any pre-served state but never from SERVED/PAID — those
// represent food a customer actually received and revenue we already
// booked.
const STATUS_LEGAL_PRIORS: Record<string, string[]> = {
  PENDING: [],
  CONFIRMED: ["PENDING"],
  PREPARING: ["PENDING", "CONFIRMED"],
  READY: ["PENDING", "CONFIRMED", "PREPARING"],
  SERVED: ["READY", "PREPARING", "CONFIRMED"],
  PAID: ["PENDING", "CONFIRMED", "PREPARING", "READY", "SERVED"],
  CANCELLED: ["PENDING", "CONFIRMED", "PREPARING", "READY"],
};

export class StaleStatusTransitionError extends Error {
  constructor(message = "STALE_TRANSITION") {
    super(message);
  }
}

export async function updateOrderStatus(
  orderId: string,
  status: string,
  restaurantId: string,
  notes?: string
) {
  const now = new Date();

  // Only stamp paidAt if the order wasn't already settled. A walk-up
  // cashier confirm stamps paidAt while the kitchen is still cooking,
  // and later the waiter marks the order SERVED which auto-promotes
  // it to PAID. Without this guard the auto-promote would overwrite
  // the original paidAt, which scrambles the per-round grouping on
  // the guest receipt — rounds get reordered or split as each order
  // is served minutes apart.
  let paidAtValue: Date | undefined = undefined;
  if (status === "PAID") {
    const existing = await db.order.findUnique({
      where: { id: orderId },
      select: { paidAt: true },
    });
    paidAtValue = existing?.paidAt ?? now;
  }

  // When the floor cancels a whole order, zero its money-shaped fields.
  // Otherwise the row keeps a non-zero total (and any pre-stamped
  // paymentMethod/tip from a "Pay X" tap), which downstream aggregations
  // — cashTotal, daily-close cash bucket, cashier ledger — silently
  // include in revenue. The per-item cancel cascade in OrderUseCases
  // already does this; this path is the whole-order analogue.
  const cancelExtras = status === "CANCELLED"
    ? { subtotal: 0, total: 0, paymentMethod: null, tip: 0, deliveryFee: 0 }
    : {};

  const legalPriors = STATUS_LEGAL_PRIORS[status];
  if (!legalPriors) {
    throw new StaleStatusTransitionError(`Unknown target status: ${status}`);
  }

  // updateMany lets us combine the id/restaurant filter with the
  // legal-prior filter atomically, so two concurrent transitions
  // race against each other on the database row instead of
  // last-writer-wins on the application side.
  const updateResult = await db.order.updateMany({
    where: {
      id: orderId,
      restaurantId,
      status: { in: legalPriors as never[] },
    },
    data: {
      status: status as never,
      paidAt: paidAtValue,
      readyAt: status === "READY" ? now : undefined,
      servedAt: status === "SERVED" ? now : undefined,
      ...(notes !== undefined ? { notes } : {}),
      ...cancelExtras,
    },
  });

  if (updateResult.count === 0) {
    // Either the order doesn't exist in this restaurant, or the
    // current status isn't a legal prior for the requested
    // transition. Caller turns this into a 409 STALE_TRANSITION.
    throw new StaleStatusTransitionError();
  }

  const order = await db.order.findUnique({
    where: { id: orderId },
    select: { id: true, status: true, orderNumber: true, notes: true },
  });

  return order!;
}

// ─── Append Items to Order ──────────────────────

export class AppendItemsError extends Error {
  code: "ORDER_NOT_FOUND" | "ITEMS_UNAVAILABLE" | "ORDER_CANCELLED";
  detail?: unknown;
  constructor(code: "ORDER_NOT_FOUND" | "ITEMS_UNAVAILABLE" | "ORDER_CANCELLED", detail?: unknown) {
    super(code);
    this.code = code;
    this.detail = detail;
  }
}

export async function appendItemsToOrder(
  orderId: string,
  items: {
    menuItemId: string;
    quantity: number;
    addOns: string[];
    wasUpsell: boolean;
    notes?: string;
  }[]
) {
  // Look up server prices + availability for every item up front. We
  // never trust the client's price field — earlier behaviour wrote
  // body.price straight to the DB, which let any caller add expensive
  // items at 1 EGP. Prices and availability come from the menu.
  const ids = items.map((i) => i.menuItemId);
  const menuRows = await db.menuItem.findMany({
    where: { id: { in: ids } },
    select: { id: true, name: true, price: true, available: true },
  });
  const byId = new Map(menuRows.map((m) => [m.id, m]));
  const unavailable: string[] = [];
  for (const item of items) {
    const m = byId.get(item.menuItemId);
    if (!m || !m.available) unavailable.push(m?.name ?? item.menuItemId);
  }
  if (unavailable.length > 0) {
    throw new AppendItemsError("ITEMS_UNAVAILABLE", unavailable);
  }

  // Wrap in transaction so item creation + total recalculation are atomic
  const order = await db.$transaction(async (tx) => {
    const exists = await tx.order.findUnique({
      where: { id: orderId },
      select: { id: true, status: true },
    });
    if (!exists) throw new AppendItemsError("ORDER_NOT_FOUND");
    // Refuse to append items to a CANCELLED order. Without this guard,
    // bolting items onto a cancelled row would push its total back
    // above zero while status stays CANCELLED — and most aggregations
    // filter out CANCELLED, so the revenue would silently disappear.
    if (exists.status === "CANCELLED") throw new AppendItemsError("ORDER_CANCELLED");

    await tx.orderItem.createMany({
      data: items.map((item) => ({
        orderId,
        menuItemId: item.menuItemId,
        quantity: item.quantity,
        price: byId.get(item.menuItemId)!.price,
        addOns: item.addOns,
        wasUpsell: item.wasUpsell,
        notes: item.notes,
      })),
    });

    // Effective total = sum of rows that are neither cancelled nor comped.
    // Excluding cancelled/comped here keeps prior cancel/comp authority
    // intact when a waiter appends items mid-meal.
    const allItems = await tx.orderItem.findMany({
      where: { orderId, cancelled: false, comped: false },
      select: { price: true, quantity: true },
    });
    const newSubtotal = Math.round(
      allItems.reduce((sum, i) => sum + toNum(i.price) * i.quantity, 0)
    );

    // Preserve the delivery fee in `total`. Without re-reading
    // orderType + deliveryFee, the earlier code stripped the fee
    // whenever items were appended to a delivery order — the rider
    // page (which derives subtotal as total − deliveryFee) then
    // rendered a negative subtotal, and the cashier under-collected
    // by the fee amount.
    const orderRow = await tx.order.findUnique({
      where: { id: orderId },
      select: { orderType: true, deliveryFee: true },
    });
    const fee = orderRow?.orderType === "DELIVERY" ? toNum(orderRow.deliveryFee) : 0;

    return tx.order.update({
      where: { id: orderId },
      data: { subtotal: newSubtotal, total: newSubtotal + fee },
      include: {
        items: {
          include: { menuItem: { select: { name: true, image: true } } },
        },
        table: { select: { number: true } },
      },
    });
  });

  return {
    id: order.id,
    orderNumber: order.orderNumber,
    status: order.status,
    tableNumber: order.table?.number ?? null,
    items: order.items.map((oi) => ({
      id: oi.menuItemId,
      name: oi.menuItem?.name ?? "Deleted item",
      quantity: oi.quantity,
      price: toNum(oi.price),
      wasUpsell: oi.wasUpsell,
    })),
    total: toNum(order.total),
  };
}

// ─── Find active order for session ──────────────

export async function getActiveOrderForSession(sessionId: string) {
  return db.order.findFirst({
    where: {
      sessionId,
      status: { notIn: ["PAID", "CANCELLED"] },
    },
    include: {
      items: {
        include: { menuItem: { select: { name: true, image: true } } },
      },
      table: { select: { number: true } },
    },
    orderBy: { createdAt: "desc" },
  });
}

// ─── Close session when every order is done ─────
//
// A session auto-closes the moment every non-cancelled order in it has
// reached PAID. Because the order-status route promotes SERVED→PAID when
// paymentMethod is already stamped (and the cashier-confirm path flips
// SERVED→PAID directly), "all PAID" is equivalent to "paid AND served"
// from the guest's perspective.
export async function maybeCloseSession(sessionId: string) {
  if (!sessionId) return;

  // Wrap the whole thing in a transaction with the per-session lock,
  // so a fresh order POST that lands milliseconds after the last
  // PAID order can't slip in between our "any open?" check and the
  // status flip. Without the lock the new order ends up PENDING on
  // a CLOSED session — kitchen cooks, nobody bills.
  await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${sessionId}, 1))`;

    const openCount = await tx.order.count({
      where: {
        sessionId,
        status: { notIn: ["PAID", "CANCELLED"] },
      },
    });
    if (openCount > 0) return;

    const paidCount = await tx.order.count({
      where: { sessionId, status: "PAID" },
    });
    if (paidCount === 0) return;

    await tx.tableSession.updateMany({
      where: { id: sessionId, status: "OPEN" },
      data: { status: "CLOSED", closedAt: new Date() },
    });
  });
}

export async function closeSessionForOrder(orderId: string) {
  const order = await db.order.findUnique({
    where: { id: orderId },
    select: { sessionId: true },
  });
  if (order?.sessionId) await maybeCloseSession(order.sessionId);
}

// ─── Restaurant ──────────────────────────────────

export async function getRestaurantBySlug(slug: string) {
  return db.restaurant.findUnique({
    where: { slug },
    select: { id: true, name: true, slug: true, currency: true },
  });
}

export async function getDefaultRestaurant() {
  return db.restaurant.findFirst({
    select: { id: true, name: true, slug: true, currency: true },
  });
}

export async function getTableByNumber(restaurantId: string, tableNumber: number) {
  return db.table.findUnique({
    where: {
      restaurantId_number: { restaurantId, number: tableNumber },
    },
    select: { id: true, number: true },
  });
}
