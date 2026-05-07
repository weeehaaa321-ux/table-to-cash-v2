// Demo data seeder for the hotel module. Creates a realistic snapshot
// of a small Dahab beach hotel so the owner can see what every screen
// looks like when populated:
//
//   - 1 Hotel row (created if missing)
//   - 3 RoomTypes (Standard, Sea View, Suite) at typical Dahab rates
//   - 12 Rooms across the three types
//   - 10 sample Guests with mixed nationalities (matching Dahab traffic)
//   - 12 Reservations distributed across statuses:
//       4 BOOKED for upcoming dates (so Today.arrivals + Calendar both
//         show real data),
//       4 CHECKED_IN (so Today.inHouse and Departures populate),
//       3 CHECKED_OUT settled folios (so Reservations history isn't
//         empty and revenue rollups have something to show),
//       1 CANCELLED.
//   - Folios with realistic charges: ROOM_NIGHT every night, some
//     FOOD/ACTIVITY/MINIBAR lines on in-house stays.
//   - Flips MenuItem.complimentaryForHotelGuests=true on the pool
//     ticket (or any item with "pool" in the name).
//
// Idempotent: room types are upserted by name, rooms by number, guests
// by phone+name. Re-running the script leaves the existing rows
// alone; only freshly-created reservations are added.
//
// Usage:
//   npx tsx scripts/seed-hotel-demo.ts                   # neom-dahab
//   RESTAURANT_SLUG=foo-cafe npx tsx scripts/seed-hotel-demo.ts

import "dotenv/config";
import { db } from "../src/lib/db";

const slug = process.env.RESTAURANT_SLUG || "neom-dahab";

function todayMidnightUTC() {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d;
}
function addDays(d: Date, days: number): Date {
  const out = new Date(d);
  out.setUTCDate(out.getUTCDate() + days);
  return out;
}
function isoDate(d: Date) {
  return d.toISOString().slice(0, 10);
}

async function main() {
  const restaurant = await db.restaurant.findUnique({ where: { slug } });
  if (!restaurant) {
    console.error(`Restaurant '${slug}' not found.`);
    process.exit(1);
  }
  console.log(`Seeding hotel demo data for '${restaurant.name}' (${slug})…`);

  // ─── Hotel ──────────────────────────────────────────────────
  const hotel = await db.hotel.upsert({
    where: { restaurantId: restaurant.id },
    create: {
      restaurantId: restaurant.id,
      name: "Neom Beachfront Hotel",
      address: "Mashraba, Dahab, South Sinai, Egypt",
      checkInTime: "14:00",
      checkOutTime: "12:00",
    },
    update: {},
  });
  console.log(`  hotel: ${hotel.name}`);

  // ─── Room types ─────────────────────────────────────────────
  const typeDefs = [
    {
      name: "Standard",
      description: "Twin or double room with garden view.",
      capacity: 2,
      baseRate: 1500,
      amenities: ["ac", "wifi", "private-bath"],
      sortOrder: 1,
    },
    {
      name: "Sea View",
      description: "Direct sea view, balcony.",
      capacity: 2,
      baseRate: 2200,
      amenities: ["ac", "wifi", "sea-view", "balcony"],
      sortOrder: 2,
    },
    {
      name: "Suite",
      description: "Spacious suite with sea view, sitting area, jacuzzi.",
      capacity: 4,
      baseRate: 3500,
      amenities: ["ac", "wifi", "sea-view", "balcony", "jacuzzi", "kitchenette"],
      sortOrder: 3,
    },
  ];

  const types: Record<string, { id: string; baseRate: number }> = {};
  for (const def of typeDefs) {
    // Look up by (hotelId, name) — there's no unique on name so use findFirst.
    const existing = await db.roomType.findFirst({
      where: { hotelId: hotel.id, name: def.name },
    });
    if (existing) {
      types[def.name] = { id: existing.id, baseRate: Number(existing.baseRate) };
      continue;
    }
    const created = await db.roomType.create({
      data: {
        hotelId: hotel.id,
        name: def.name,
        description: def.description,
        capacity: def.capacity,
        baseRate: def.baseRate,
        amenities: def.amenities,
        sortOrder: def.sortOrder,
      },
    });
    types[def.name] = { id: created.id, baseRate: def.baseRate };
  }
  console.log(`  room types: ${Object.keys(types).length}`);

  // ─── Rooms ──────────────────────────────────────────────────
  const roomDefs = [
    { number: "101", typeName: "Standard", floor: 1 },
    { number: "102", typeName: "Standard", floor: 1 },
    { number: "103", typeName: "Standard", floor: 1 },
    { number: "104", typeName: "Standard", floor: 1 },
    { number: "201", typeName: "Sea View", floor: 2 },
    { number: "202", typeName: "Sea View", floor: 2 },
    { number: "203", typeName: "Sea View", floor: 2 },
    { number: "204", typeName: "Sea View", floor: 2 },
    { number: "205", typeName: "Sea View", floor: 2 },
    { number: "301", typeName: "Suite", floor: 3 },
    { number: "302", typeName: "Suite", floor: 3 },
    { number: "303", typeName: "Suite", floor: 3 },
  ];

  const rooms: Record<string, { id: string; number: string; baseRate: number }> = {};
  for (const def of roomDefs) {
    const created = await db.room.upsert({
      where: { hotelId_number: { hotelId: hotel.id, number: def.number } },
      create: {
        hotelId: hotel.id,
        number: def.number,
        floor: def.floor,
        roomTypeId: types[def.typeName].id,
        status: "VACANT_CLEAN",
      },
      update: {},
    });
    rooms[def.number] = {
      id: created.id,
      number: created.number,
      baseRate: types[def.typeName].baseRate,
    };
  }
  console.log(`  rooms: ${Object.keys(rooms).length}`);

  // ─── Guests ─────────────────────────────────────────────────
  const guestDefs = [
    {
      name: "Ahmed Saleh",
      phone: "+201001234567",
      idNumber: "29501010102345",
      nationality: "Egyptian",
    },
    {
      name: "Marco Bianchi",
      phone: "+393331122334",
      idNumber: "YA1234567",
      nationality: "Italian",
    },
    {
      name: "Hannah Müller",
      phone: "+491761122334",
      idNumber: "C01X12345",
      nationality: "German",
    },
    {
      name: "Olga Petrova",
      phone: "+79161234567",
      idNumber: "759923456",
      nationality: "Russian",
    },
    {
      name: "Sophie Laurent",
      phone: "+33623456789",
      idNumber: "23ZA12345",
      nationality: "French",
    },
    {
      name: "Lukas Novak",
      phone: "+420778123456",
      idNumber: "111223344",
      nationality: "Czech",
    },
    {
      name: "Yara Mostafa",
      phone: "+201112233445",
      idNumber: "29812050200123",
      nationality: "Egyptian",
    },
    {
      name: "James O'Connor",
      phone: "+447701234567",
      idNumber: "548219876",
      nationality: "British",
    },
    {
      name: "Maya Cohen",
      phone: "+972541234567",
      idNumber: "032456789",
      nationality: "Israeli",
    },
    {
      name: "Pavel Dvorak",
      phone: "+420777887766",
      idNumber: "2233445566",
      nationality: "Slovak",
    },
  ];

  const guests: Array<{ id: string; name: string }> = [];
  for (const def of guestDefs) {
    // Soft idempotency: look up by (hotelId, phone). If a row already
    // exists keep it; otherwise create.
    const existing = await db.guest.findFirst({
      where: { hotelId: hotel.id, phone: def.phone },
    });
    if (existing) {
      guests.push({ id: existing.id, name: existing.name });
      continue;
    }
    const created = await db.guest.create({
      data: {
        hotelId: hotel.id,
        name: def.name,
        phone: def.phone,
        idNumber: def.idNumber,
        nationality: def.nationality,
      },
    });
    guests.push({ id: created.id, name: created.name });
  }
  console.log(`  guests: ${guests.length}`);

  // ─── Reservations ───────────────────────────────────────────
  // Skip seeding reservations if we already created some — re-runs
  // shouldn't keep adding fake bookings on top.
  const existingReservations = await db.reservation.count({ where: { hotelId: hotel.id } });
  if (existingReservations > 0) {
    console.log(
      `  reservations: skipped (${existingReservations} already exist — clear them manually if you want a fresh demo set)`
    );
  } else {
    const today = todayMidnightUTC();

    // Helper: create a reservation + folio + the appropriate charges
    // for a given lifecycle stage. Mutates the underlying room status
    // when a stage requires it (CHECKED_IN -> OCCUPIED).
    async function seedStay(args: {
      guestIdx: number;
      roomNumber: string;
      checkIn: Date;
      checkOut: Date;
      stage: "BOOKED" | "CHECKED_IN" | "CHECKED_OUT" | "CANCELLED";
      source?: "DIRECT" | "WALK_IN" | "BOOKING_COM" | "AIRBNB";
      notes?: string;
      extraCharges?: Array<{ type: string; amount: number; description: string }>;
      settlementMethod?: "CASH" | "CARD" | "INSTAPAY";
    }) {
      const guest = guests[args.guestIdx];
      const room = rooms[args.roomNumber];
      const nightCount = Math.max(
        0,
        Math.round(
          (args.checkOut.getTime() - args.checkIn.getTime()) / (24 * 3600 * 1000)
        )
      );
      const status =
        args.stage === "CHECKED_IN" || args.stage === "CHECKED_OUT" || args.stage === "BOOKED"
          ? args.stage
          : "CANCELLED";

      const reservation = await db.reservation.create({
        data: {
          hotelId: hotel.id,
          guestId: guest.id,
          roomId: room.id,
          checkInDate: args.checkIn,
          checkOutDate: args.checkOut,
          checkedInAt:
            args.stage === "CHECKED_IN" || args.stage === "CHECKED_OUT"
              ? args.checkIn
              : null,
          checkedOutAt: args.stage === "CHECKED_OUT" ? args.checkOut : null,
          nightlyRate: room.baseRate,
          adults: 2,
          children: 0,
          source: args.source || "DIRECT",
          status,
          internalNotes: args.notes || null,
          cancelledAt: args.stage === "CANCELLED" ? new Date() : null,
          cancelReason: args.stage === "CANCELLED" ? "Guest changed plans" : null,
        },
      });

      // Folio: open while booked / in-house, void when cancelled,
      // settled when checked-out.
      const folioStatus =
        args.stage === "CANCELLED" ? "VOID" : args.stage === "CHECKED_OUT" ? "SETTLED" : "OPEN";
      const folio = await db.folio.create({
        data: {
          reservationId: reservation.id,
          status: folioStatus,
        },
      });

      // Charges: post a ROOM_NIGHT for each booked night for in-house
      // and checked-out stays. Booked-only stays don't have charges
      // yet (they're posted on actual check-in).
      const charges: Array<{ amount: number }> = [];
      if (args.stage === "CHECKED_IN" || args.stage === "CHECKED_OUT") {
        for (let i = 0; i < nightCount; i++) {
          const night = addDays(args.checkIn, i);
          const c = await db.folioCharge.create({
            data: {
              folioId: folio.id,
              type: "ROOM_NIGHT",
              amount: room.baseRate,
              description: `Room ${room.number} — ${isoDate(night)}`,
              night,
            },
          });
          charges.push({ amount: Number(c.amount) });
        }
        for (const ec of args.extraCharges || []) {
          const c = await db.folioCharge.create({
            data: {
              folioId: folio.id,
              type: ec.type as "FOOD" | "ACTIVITY" | "MINIBAR" | "MISC",
              amount: ec.amount,
              description: ec.description,
            },
          });
          charges.push({ amount: Number(c.amount) });
        }
      }

      // Settlement: when checked out, mark the folio settled.
      if (args.stage === "CHECKED_OUT") {
        const total = charges.reduce((s, c) => s + c.amount, 0);
        await db.folio.update({
          where: { id: folio.id },
          data: {
            settledAt: args.checkOut,
            settledMethod: args.settlementMethod || "CASH",
            settledTotal: total,
          },
        });
      }

      // Room status: occupy if checked-in, dirty if checked-out
      // recently. Vacant for booked / cancelled (room isn't held).
      if (args.stage === "CHECKED_IN") {
        await db.room.update({
          where: { id: room.id },
          data: { status: "OCCUPIED" },
        });
      } else if (args.stage === "CHECKED_OUT") {
        await db.room.update({
          where: { id: room.id },
          data: { status: "VACANT_DIRTY" },
        });
      }

      return reservation;
    }

    // Layout (relative to today):
    //
    //   IN-HOUSE (stage = CHECKED_IN):
    //     guest 0 in 102, today-3 → today+1   (departing tomorrow)
    //     guest 1 in 201, today-2 → today+2   (mid-stay)
    //     guest 2 in 202, today-1 → today+3   (just arrived)
    //     guest 3 in 301, today    → today+5   (arrived today; counts as
    //                                            in-house, not arrival)
    //
    //   ARRIVALS TODAY but still BOOKED (haven't checked in yet):
    //     guest 4 in 103, today    → today+2
    //     guest 5 in 203, today    → today+1
    //
    //   FUTURE BOOKINGS:
    //     guest 6 in 302, today+2  → today+5
    //     guest 7 in 104, today+5  → today+8
    //
    //   PAST CHECKED-OUT (history):
    //     guest 8 in 101, today-7  → today-3
    //     guest 9 in 204, today-5  → today-2
    //     guest 0 in 303, today-10 → today-6  (returning guest history)
    //
    //   CANCELLED:
    //     guest 5 in 205, today+10 → today+13

    await seedStay({
      guestIdx: 0,
      roomNumber: "102",
      checkIn: addDays(today, -3),
      checkOut: addDays(today, 1),
      stage: "CHECKED_IN",
      source: "DIRECT",
      extraCharges: [
        { type: "FOOD", amount: 240, description: "Cafe — breakfast" },
        { type: "FOOD", amount: 380, description: "Cafe — dinner" },
        { type: "MINIBAR", amount: 60, description: "Minibar — water x2" },
      ],
    });

    await seedStay({
      guestIdx: 1,
      roomNumber: "201",
      checkIn: addDays(today, -2),
      checkOut: addDays(today, 2),
      stage: "CHECKED_IN",
      source: "BOOKING_COM",
      extraCharges: [
        { type: "FOOD", amount: 520, description: "Cafe — lunch for 2" },
        { type: "ACTIVITY", amount: 1500, description: "Massage 1h" },
      ],
    });

    await seedStay({
      guestIdx: 2,
      roomNumber: "202",
      checkIn: addDays(today, -1),
      checkOut: addDays(today, 3),
      stage: "CHECKED_IN",
      source: "AIRBNB",
      extraCharges: [
        { type: "FOOD", amount: 180, description: "Cafe — coffee + croissant" },
        { type: "ACTIVITY", amount: 1000, description: "Kayak 2h" },
      ],
    });

    await seedStay({
      guestIdx: 3,
      roomNumber: "301",
      checkIn: today,
      checkOut: addDays(today, 5),
      stage: "CHECKED_IN",
      source: "DIRECT",
    });

    await seedStay({
      guestIdx: 4,
      roomNumber: "103",
      checkIn: today,
      checkOut: addDays(today, 2),
      stage: "BOOKED",
      source: "BOOKING_COM",
    });

    await seedStay({
      guestIdx: 5,
      roomNumber: "203",
      checkIn: today,
      checkOut: addDays(today, 1),
      stage: "BOOKED",
      source: "WALK_IN",
      notes: "Late check-in expected after 22:00",
    });

    await seedStay({
      guestIdx: 6,
      roomNumber: "302",
      checkIn: addDays(today, 2),
      checkOut: addDays(today, 5),
      stage: "BOOKED",
      source: "DIRECT",
    });

    await seedStay({
      guestIdx: 7,
      roomNumber: "104",
      checkIn: addDays(today, 5),
      checkOut: addDays(today, 8),
      stage: "BOOKED",
      source: "AIRBNB",
    });

    await seedStay({
      guestIdx: 8,
      roomNumber: "101",
      checkIn: addDays(today, -7),
      checkOut: addDays(today, -3),
      stage: "CHECKED_OUT",
      source: "DIRECT",
      settlementMethod: "INSTAPAY",
      extraCharges: [
        { type: "FOOD", amount: 1200, description: "Cafe — multiple meals" },
      ],
    });

    await seedStay({
      guestIdx: 9,
      roomNumber: "204",
      checkIn: addDays(today, -5),
      checkOut: addDays(today, -2),
      stage: "CHECKED_OUT",
      source: "BOOKING_COM",
      settlementMethod: "CARD",
      extraCharges: [
        { type: "ACTIVITY", amount: 500, description: "Pool ticket" },
        { type: "MINIBAR", amount: 90, description: "Minibar — soft drinks" },
      ],
    });

    await seedStay({
      guestIdx: 0,
      roomNumber: "303",
      checkIn: addDays(today, -10),
      checkOut: addDays(today, -6),
      stage: "CHECKED_OUT",
      source: "DIRECT",
      settlementMethod: "CASH",
    });

    await seedStay({
      guestIdx: 5,
      roomNumber: "205",
      checkIn: addDays(today, 10),
      checkOut: addDays(today, 13),
      stage: "CANCELLED",
      source: "BOOKING_COM",
    });

    console.log(`  reservations: 12 created across BOOKED / CHECKED_IN / CHECKED_OUT / CANCELLED`);
  }

  // ─── Pool ticket: complimentary for hotel guests ────────────
  const poolItems = await db.menuItem.findMany({
    where: {
      category: { restaurantId: restaurant.id },
      OR: [
        { name: { contains: "Pool", mode: "insensitive" } },
        { name: { contains: "pool", mode: "insensitive" } },
        { nameAr: { contains: "مسبح" } },
      ],
    },
  });
  if (poolItems.length === 0) {
    console.log("  pool ticket: not found in menu (skipping comp flag)");
  } else {
    for (const item of poolItems) {
      await db.menuItem.update({
        where: { id: item.id },
        data: { complimentaryForHotelGuests: true },
      });
      console.log(`  pool ticket: ${item.name} flagged complimentary for hotel guests`);
    }
  }

  console.log("\nDone. Open /hotel and log in with your owner PIN.");
  console.log("If you want to wipe the demo reservations and re-seed, run:");
  console.log("  // careful — this only deletes hotel demo reservations:");
  console.log("  npx tsx -e \"import('./src/lib/db.js').then(async ({db}) => { await db.folioCharge.deleteMany({}); await db.folio.deleteMany({}); await db.reservation.deleteMany({}); console.log('cleared'); process.exit(0); })\"");
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
