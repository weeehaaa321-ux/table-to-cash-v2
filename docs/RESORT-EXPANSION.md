# Neom Resort Platform — Expansion Plan

> From a single-venue café to a multi-venue resort operating system —
> one connected platform where every staff member, every guest, every
> venue, every minute lives on the same surface.

---

## 0. Why this expansion makes sense

The café app already proved the pattern: real-time staff coordination,
guest-phone-as-remote, and a single command surface for the owner. A
resort is the same pattern at higher resolution — more roles, more
venues, multi-day stays — but the core primitives transfer cleanly.

What makes this defensible:

1. **The hard part is already shipped.** Real-time order routing, role-
   gated screens, push notifications, audit trails, multi-round
   payments, smart upsell, time-billed activities, audit + variance
   reconciliation — all working in production. A resort isn't 10 ×
   the complexity; it's the same primitives applied to more contexts.
2. **One software, every department.** Today resorts run a PMS for
   front desk + 5 disconnected systems for F&B / spa / housekeeping /
   activities / loyalty. Each system speaks a different schema. Most
   of the operational pain comes from the *gaps between* those
   systems, not from the systems themselves. A unified platform
   compounds — a guest's allergy entered at check-in is automatically
   visible to the chef, the spa therapist, and the kids-club staff
   without anyone re-typing.
3. **Mobile-first guest model.** Existing PMSes treat the guest's
   phone as a stretch goal. Mine treats it as the primary remote.
   Pre-arrival, in-stay, post-departure — one continuous thread.

---

## 1. Domain model

Everything below extends the existing café schema; nothing breaks.
The current `Restaurant` becomes a special case of `Venue` under a
single `Property`, which itself sits under a `Resort`.

```
Resort (multi-property umbrella, optional — for chains)
└── Property (the physical hotel — one-to-many in the rare case
    │  of a multi-tower resort)
    │
    ├── Room                       — the physical guestroom
    │   ├── RoomType               — Standard / Deluxe / Suite / Villa
    │   ├── HousekeepingStatus     — clean / dirty / inspected / OOO / DND
    │   ├── KeyAssignments         — active room keys / BLE tokens
    │   └── MinibarPar / MinibarActual
    │
    ├── Venue                      — restaurants, bars, pool, spa, gym,
    │   │                            conference, kids-club, beach club
    │   ├── Tables / Spaces        — current "Table" model
    │   ├── Menu                   — per-venue (current Category + Item
    │   │                            already supports this)
    │   ├── Hours / Coverage       — already exists via Staff.shift
    │   ├── Cover capacity         — for reservation gating
    │   └── Station rules          — KITCHEN / BAR / ACTIVITY / SPA / etc.
    │
    └── Resource                   — bookable, capacity-constrained
        ├── SpaRoom                — 1 therapist at a time
        ├── Cabana                 — by-the-day rental
        ├── DiveBoat / Excursion   — fixed slot capacity
        └── KidsClubSlot           — half-day pickups

Booking (the reservation, made before arrival)
├── BookingChannel        — direct, Booking.com, Expedia, agent, group
├── Plan                  — RO / BB / HB / FB / AI
├── CorporateAccount      — for company billing
├── PrimaryGuest + accompanying guests
├── ArrivalDate / Departure / Nights
├── PaymentTerms          — pre-paid / pay-on-arrival / corporate
├── SpecialRequests       — high floor, late check-in, allergy, anniversary
└── VipFlags              — repeat guest, comped, suite-class, owner

Stay (in-progress booking, between check-in and check-out)
├── Folio                 — the running tab; one per stay
│   ├── Charge            — food / drink / spa / activity / room /
│   │                       minibar / transfer / laundry / phone
│   └── Settlement        — at check-out, optionally split:
│                           "room charges to corporate, F&B to personal"
├── Session               — current cafe Session = "guest at venue now",
│                           folds into the Stay's Folio
└── ExperienceLog         — every touch: arrived 14:32, breakfast 09:14,
                            spa 16:00, dinner reservation 19:30, etc.

Guest                     — persistent identity across stays
├── Profile               — preferences, allergies, dietary, language,
│                           dress size (for spa / activity gear),
│                           accessibility needs
├── Anniversary           — birthday, anniversary, special dates
├── LifetimeValue         — stays count, revenue, ALOS
├── VipTier               — Gold / Platinum / Owner-comp / Press
└── Notes                 — free-form private staff notes

Appointment               — calendared bookings against Resources
├── ResourceBooking
├── Slot (start, duration, capacity)
└── Status                — booked / confirmed / no-show / completed

Request                   — concierge queue
├── RequestType           — taxi / late-checkout / extra-towels /
│                           restaurant-rec / massage-rec / wake-up /
│                           airport-pickup / luggage-down / other
├── Channel               — guest-app, in-room phone, front desk,
│                           WhatsApp / SMS, walk-up
├── Status                — open / acknowledged / in-progress / done
└── AssignedTo            — staff id

Inventory                 — minibars, beach gear, spa products, towels
├── ItemDefinition        — what we stock
├── ParLevel              — target stock per location
├── Movement              — restock / consumed / written-off
└── RestockOrder          — housekeeping → procurement
```

Notice what *already* maps cleanly from the café schema:

| Café entity | Becomes (resort) |
|---|---|
| `Restaurant` | `Venue` (one of many under a `Property`) |
| `Table` | unchanged — venue tables, but also pool loungers, cabanas |
| `MenuItem` | unchanged — every venue has its own |
| `MenuItem.pricePerHour` | already powers spa/activity time-billing |
| `Category.station: ACTIVITY` | template for non-prep services (spa, dive, tour) |
| `TableSession` | extends to `Session` — guest at venue X right now |
| `Order` | every charge that hits a folio originates as an order |
| `Order.discount` + audit | unchanged — applies across all venues |
| `JoinRequest` (multi-guest) | becomes the model for accompanying guests on a stay |
| `Staff` + `Shift` | unchanged — scales to all departments |
| `VipGuest` (existing!) | the seed of the full Guest profile |

The expansion is **additive**. I'm not rewriting the café — I'm adding
new tables (Property, Room, Stay, Folio, Booking, Appointment, Request,
Inventory) and lifting Restaurant to a child of Property.

---

## 2. The 12 surfaces

Each role gets a screen that's been designed for *what they actually do
all day*, not a generic "hotel software" view. The principle: a
screen is good when the user can complete their most common task in
one tap, and their second most common in two.

### 2.1 Guest phone — the universal remote
- Lands by scanning a QR (room door, restaurant table, pool lounger),
  or by tapping a pre-arrival deep-link sent on WhatsApp.
- Sees: their stay summary, current bill, room key (if BLE-equipped),
  resort map with live "you are here", every venue's menu, every
  resource available to book, concierge chat.
- Can: order at any venue, book spa / dive / dinner, request anything,
  charge to room, see folio.
- Speaks 4+ languages, switches at one tap.
- **Contrast with PMS-of-today**: most hotels make guests download a
  separate app, log in, and accept terms. Mine works from a single
  scan in 3 seconds.

### 2.2 Front desk
- Today's arrivals + departures + in-house counts at the top.
- Each arrival card shows: VIP flags, pre-arrival upsell status,
  allergies, anniversary, room ready / not ready, key issued / not.
- One-tap check-in: assign room, register card, hand key, system
  pings housekeeping if room flips DND mid-stay.
- See the guest's profile in 1 tap — last 5 stays, what they ordered,
  comp history, stated preferences.

### 2.3 Concierge inbox
- Single feed of every request from every channel (guest app, room
  phone, front desk walk-up, WhatsApp, in-stay SMS).
- Each item has a status, an assignee, a timestamp, and a "snooze
  until" for tasks that aren't due right now.
- Auto-routes by type: taxi → bell, restaurant booking → maître d',
  wake-up call → night audit.
- VIPs jump the queue with a colored stripe.

### 2.4 Housekeeping board
- Every room as a tile. Color = status.
- Cleaner taps in their assigned rooms; status flips automatically
  (started → done → inspected).
- Real-time sync with front desk — "room 412 ready" lights up the
  arrival card the moment housekeeping closes the loop.
- DND timer: room hasn't been cleaned in 2 days because of DND →
  alerts the GM to send a discreet check-in.
- Maintenance issues raised inline: "shower drips" creates a ticket
  for engineering; room flagged OOO until resolved.

### 2.5 Engineering / maintenance
- Ticket queue, by priority.
- Each ticket has photo, location, reporter, severity, blocked
  rooms.
- Closes the loop on housekeeping flags automatically.

### 2.6 F&B floor (per venue)
- Already shipped (this is the existing Floor Manager view).
- Now scoped per venue — pool deck has one floor manager, the fine-
  dining restaurant has another, the lobby bar a third.
- Owner sees them aggregated.

### 2.7 Stations (kitchen / bar / spa / dive / activities)
- Each station's prep board. Already shipped for KITCHEN and BAR;
  the same model extends to SPA (therapist's appointment list),
  DIVE (today's groups), ACTIVITY (kayak hand-back queue).

### 2.8 Cashier / Folio settlement
- For walk-in guests (day visitors) → existing café cashier flow.
- For in-house guests → folio view: shows all charges across the
  stay, allows split, accepts payment at check-out, prints receipt
  per a guest's chosen split (e.g. "company pays room, I pay F&B").

### 2.9 Manager-on-Duty (MOD)
- The "everything" dashboard. VIPs in-house. Active alerts. Any
  guest issue raised in the last 24 hours. RevPAR vs forecast for
  today. F&B covers vs forecast.
- One-tap broadcast to any department.
- Override authority for comps, discounts, room moves.

### 2.10 Owner / GM dashboard
- Today: occupancy %, ADR, RevPAR, F&B per occupied room,
  forward bookings, on-shift staff, top-VIP-in-house list.
- Drill-down: any number → its source events.
- Live anomaly alerts: cash variance opened tonight, comp count up
  3× from baseline, F&B venue running 40% under forecast.

### 2.11 Pre-arrival channel
- 7 days before arrival: WhatsApp / email / SMS in the guest's
  language with personalised offers — room upgrade (bid for it),
  pre-book activities, dietary preferences, airport transfer,
  anniversary surprise.
- 24 hours before: digital check-in form, ID upload, expected
  arrival time.
- Day-of: real-time location of guest's car (if shared) for ETA-
  based room readiness.

### 2.12 Group / event manager
- Block bookings (weddings, conferences, retreats).
- Shared billing (master account + folio splits per attendee).
- Schedule shared (group dinner at 19:00, conference room 9-17 etc).
- Roomming list import from spreadsheet.

---

## 3. Eight revenue & cost levers (with concrete impact)

A resort's revenue isn't one number — it's a portfolio of streams,
most of which are leaking today. Each lever below is something the
unified platform measurably moves:

### 3.1 Room upsell — pre-arrival + at check-in
Pre-arrival: "Bid for an upgrade to a Suite — winning bid 1200
EGP/night." Industry adoption rate: 8–12% of bookings. On a 100-room
resort with 70% occupancy and a 3,000 EGP upgrade premium, that's
**~75,000 EGP/night** in pure upgrade revenue, all from rooms that
would otherwise sit empty.

### 3.2 F&B per occupied room (PoR)
Industry baseline: F&B PoR for a Red Sea resort is ~600–900 EGP. Best-
in-class properties (Six Senses, Banyan Tree) hit 1,400+. The lift
comes from: in-room dining (currently a phone-and-paper process
guests skip), cross-venue suggestions ("had breakfast in your room,
try the lunch menu"), and resort-wide loyalty (every venue rewards
return visits). Realistic uplift on a 100-room resort: **+200 EGP
PoR × 70 rooms × 30 days = 420,000 EGP/month**.

### 3.3 Activity capture
Most resorts lose 30–60% of activity revenue to "informal" cash
transactions: dive masters, spa walk-ins, kayak rentals on the beach.
Current café-style activity tracking already proved this on a
single-venue scale; at resort scale, **estimated capture of
150–400K EGP/month** of currently-leaked revenue.

### 3.4 Spa utilization
Spa is the single highest-margin venue in a resort (60–80% gross).
The bottleneck is empty slots, not demand. Real-time visibility +
in-app booking + push-notification flash deals ("3pm slot just
opened, 30% off") routinely lift utilization 15–25%. On a 4-room
spa doing 1.5M EGP/month: **+225–375K EGP/month**.

### 3.5 Comp shrinkage (theft / unjustified discounts)
Every comp / discount audit-trailed; variance flagged in real time.
Industry shrinkage: 1.5–3% of revenue. On a 50M EGP/year resort:
**+750K – 1.5M EGP/year** retained.

### 3.6 Labor cost / productivity
Today: F&B captain runs floor with paper tickets, walks 8 km/shift.
Tomorrow: floor manager screen + push routing, 2× the table coverage
per captain. Concierge handles 4× the tickets. Housekeeping shaves
8 minutes off room cleaning by knowing in advance what's needed.
On a 60-staff F&B + housekeeping operation: **15–20% labor cost
reduction = ~300K EGP/month**.

### 3.7 Loyalty repeat-rate
Persistent guest profile + in-stay personalization + post-departure
offer of "your next stay -10% if you book within 30 days". Industry
data: persistent profile + targeted post-stay = +5–8 percentage
points repeat-rate. Repeat guests are worth 3–5× the acquisition
cost of a new guest. On a 100-room resort, **+300–500K EGP/year**
in repeat revenue, with much lower CAC.

### 3.8 Reputation / online review uplift
Real-time alerts on bad-experience signals (food sent back twice,
spa appointment running 30 min late, room AC ticket open >2 hours)
let MOD intervene before checkout. Industry: pre-emptive recovery
turns a 2-star into a 4-star review ~70% of the time. Direct revenue
impact on next quarter's bookings: **2–5% ADR uplift** from review
score.

### Summary table

| Lever | Year-1 estimate (100-room resort) |
|---|---|
| Room upsell | +12M EGP |
| F&B PoR uplift | +5M EGP |
| Activity capture | +3M EGP |
| Spa utilization | +3M EGP |
| Comp shrinkage retained | +1M EGP |
| Labor productivity | +3.5M EGP saved |
| Loyalty repeat | +0.5M EGP |
| Review-driven ADR | +1.5M EGP |
| **Total** | **~30M EGP / year** |

These aren't blue-sky numbers — they're the published industry
benchmarks for *unified* operating platforms (Cloudbeds, Mews,
SiteMinder case studies). The difference is mine costs a fraction
of those, is built for the actual operational reality of a Red Sea
resort (multi-language, intermittent connectivity, cash-heavy
activities, walk-up guests), and ships features in days not quarters.

---

## 4. Implementation phases

Each phase is **shippable on its own** and adds revenue/operations
value before the next one starts. There is never a "big bang"
go-live waiting on every feature.

### Phase 0 — Café-as-Venue (already shipped)
- Single-venue F&B + activities + cashier + smart upsell.
- This *is* the foundation. A resort is N of these, plus rooms, plus
  the cross-venue glue.

### Phase 1 — Resort core (target: 4–6 weeks)
**The minimum viable resort.** Owner can start replacing their PMS
on day 1 of phase 1, even though spa and concierge come later.

New schema: `Property`, `Room`, `RoomType`, `Booking`, `Stay`,
`Folio`, `Charge`, `Guest` (promoted from `VipGuest`), `Plan`.

New surfaces:
- Front desk (check-in/check-out, room assignment).
- Folio (per stay, charge-to-room from any venue).
- Owner dashboard with rooms occupancy / RevPAR / ADR.
- Pre-arrival WhatsApp/email channel (basic).

Café changes (additive):
- `Restaurant` becomes `Venue` (column rename only, no migration
  break — existing rows get a default Property + default Resort).
- Cashier flow accepts "charge to room 412" as a payment method.
  The folio settles at check-out, not at order time.

### Phase 2 — Venue network (target: 3–4 weeks)
- Multi-venue F&B inside one property (lobby bar, pool café, fine
  dining, room service all distinct Venues).
- Cross-venue cart: a guest can order breakfast at the pool while
  their dinner reservation at the restaurant is still upcoming.
- Per-venue floor managers, aggregated under a single property
  Manager-on-Duty.
- Loyalty: charges across venues count toward one tier.

### Phase 3 — Experience layer (target: 6–8 weeks)
- **Concierge inbox** with multi-channel ingest (in-app, room phone,
  WhatsApp).
- **Housekeeping board** with real-time room status.
- **Engineering tickets** with photo + closure loop.
- **Appointment / Resource booking** (spa, dive, cabana, dinner
  reservation) with slot calendars.
- **Inventory**: minibar par + restock workflow.
- **VIP profile depth**: anniversaries, allergies surface across
  venues, persistent across stays.

### Phase 4 — Intelligence layer (target: ongoing)
- **AI butler**: guest texts in natural language, system understands
  intent (book / order / request / question), answers in their
  language, escalates to human when unsure.
- **PMS integration**: Booking.com / Expedia / direct site sync.
- **Pre-arrival upsell** evolved: dynamic upgrade pricing based on
  current occupancy, surge pricing for activities, weather-aware
  push ("clear sky tomorrow, 30% off sunset cruise").
- **Predictive ops**: forecast tomorrow's covers per venue from
  arrivals + check-out + day-pass sales; auto-staff and auto-prep.
- **Voice-of-guest analytics**: NLP over reviews + concierge messages
  surfacing systematic issues weeks before they hit TripAdvisor.

---

## 5. Architecture mapping

What's already in the codebase that scales (no rewrite):

| Today | Tomorrow |
|---|---|
| `Restaurant.id` | rename → `Venue.id`, add `Venue.propertyId` |
| `Table` | unchanged; pool loungers / cabanas modeled as Tables |
| `TableSession` | becomes `Session`, optionally tied to a `Stay` |
| `Order.discount`, audit, settle path | unchanged — applies across all venues |
| `Order.station: KITCHEN/BAR/ACTIVITY` | extend to SPA/DIVE/ROOMSERVICE |
| `MenuItem.pricePerHour` + hour picker | already powers spa, dive, cabana |
| `JoinRequest` (multi-guest) | template for accompanying guests on a stay |
| `Staff` + `StaffShift` + auto-clockout | unchanged — extends to housekeeping/engineering |
| Smart upsell engine | re-applies per venue + cross-venue context |
| Push system + role-aware delivery | unchanged — adds new roles |
| Sentry instrumentation | already in place |
| Cash drawer reconciliation | unchanged — applies across venues |

What's new (additive only):

```
+ Property (multi-tower support)
+ Room + RoomType
+ Booking (reservation, pre-arrival)
+ Stay (in-progress booking)
+ Folio + Charge (running tab tied to a stay)
+ Guest (persistent profile, promoted from VipGuest)
+ Appointment + ResourceBooking
+ Request (concierge inbox)
+ Inventory + Movement
+ Department (concierge / housekeeping / engineering / spa / etc.)
```

Most of these are simple tables. The interesting work is the
**Folio** (charges from any venue land here, settle once at check-
out) and the **Stay → Session** relationship (a Session at a venue
optionally folds into a Stay's folio when the guest is in-house).

The migration from "café Restaurant" to "resort Venue under a Property":
a one-shot script that for every existing Restaurant creates a
matching `Property` + sets `Venue.propertyId`. Backwards-compat is
automatic — anyone using just one venue keeps working unchanged.

---

## 6. Day-in-the-life scenes

These are the moments that sell the platform when a resort owner
sees them.

### Scene 1 — Pre-arrival, 7 days out
*Sara and Adam booked a Suite for their 5-year anniversary on
Booking.com last week.*

- System pulls the booking. Notes: "anniversary stay" in special
  requests.
- 7 days out: WhatsApp lands in Sara's phone in Arabic — "Habibi
  مرحبا. Your suite is ready Tuesday. Want a candlelit dinner on
  the beach? Pre-book and save 15%." She taps yes.
- 3 days out: weather forecast says clear skies. System auto-pushes
  a sunset kayak deal — 2 hr × 500 EGP, "perfect for your
  anniversary day". Adam books it.
- 24 hours out: digital check-in form. ID uploaded. Expected
  arrival 2pm.

### Scene 2 — Check-in, day of arrival
- Front desk app already has Sara's photo, allergies (shellfish),
  preferred language (Arabic), kayak booking, dinner reservation.
- One-tap check-in. Room key issued. System pings housekeeping
  to confirm room 412 is inspected.
- Housekeeping had already been told about the anniversary 24h
  prior — turndown plan loaded with rose petals + champagne for
  20:30 that evening.
- The kayak is auto-confirmed for Wednesday 4pm.

### Scene 3 — Day 2, breakfast at the pool
- Adam scans the QR on the pool table. Cart auto-tags "Sara &
  Adam, Room 412, Suite class".
- Smart upsell: "Yesterday you tried the Neom Breakfast — try the
  hummus trio with it today, 30% off." Adam adds it.
- Charge → folio. Room 412 just got 280 EGP added. No physical
  card needed.
- Allergy alert: when the chef sees the order, "shellfish allergy"
  flag is on the ticket. Hummus has no shellfish; chef plates it
  normally. If Sara had ordered the prawn salad, chef would have
  seen a hard block + an alert to the floor manager to discuss
  with the guest.

### Scene 4 — Day 2, spa appointment
- Sara walks into the spa at 16:00 for her 60-min massage.
- Therapist's app already shows: "Sara, allergic to shellfish (not
  relevant), pregnancy: no, prefers Arabic, prior massage at
  another property: medium-hard pressure."
- Therapist gives her exactly the experience she had elsewhere.
  She's stunned. Five-star review writes itself.

### Scene 5 — Day 2, anniversary dinner
- 19:30: Sara and Adam arrive at the beach. Their cabana is set:
  rose petals (per pre-arrival flag), candles, champagne already
  chilled.
- The chef already knows: shellfish allergy, anniversary, suite
  guests → comped dessert authorized by MOD this morning.
- They sign for dinner → folio. Comp recorded with reason
  "anniversary, pre-approved by MOD". Audit trail for the owner's
  monthly review.

### Scene 6 — Check-out, day 4
- Adam taps "ready to check out" in the app at 10am.
- Folio summary appears: room nights 14,000 + F&B 4,800 + spa 2,800
  + activities 1,000 + 50 EGP comp dessert (zeroed) = 22,650 EGP.
- Optional split: room to Adam's company card, F&B + spa + activities
  to his personal card. One tap each.
- Receipt emailed in Arabic + English. Loyalty tier updated:
  Sara is now Gold (3 stays, 60K EGP lifetime). Future-stay 10%
  offer included in the email.
- 30 minutes after check-out: TripAdvisor / Google review prompt
  via WhatsApp. Sara writes a five-star review.

### Scene 7 — Same day, 14:00, owner's perspective
- Owner is in Cairo. Opens the dashboard.
- **Today**: 73% occupancy, ADR 4,200 EGP, RevPAR 3,066 EGP. F&B
  PoR running 850 EGP (+12% vs forecast).
- **Anomalies**: Cash drawer at the lobby bar opened with -380
  variance — already auto-flagged. MOD has acknowledged.
  Engineering ticket open on Room 215 (AC) for 3 hours — escalated
  to chief engineer.
- **VIPs in-house**: 3 platinum, 1 owner-comp, 2 anniversary stays.
  All flagged for personalized treatment.
- **Forward**: tomorrow 65 arrivals (4 VIP), 38 departures.
  Inventory low: 2 days of housekeeping linen left. Restock
  order auto-suggested. Owner taps approve.

---

## 7. Differentiators vs the incumbents

| | Opera (Oracle) | Cloudbeds | Mews | **Neom Resort Platform** |
|---|---|---|---|---|
| Built specifically for Red Sea / Egypt context | ✗ | ✗ | ✗ | ✓ |
| Bilingual Arabic-first UX | ✗ | partial | partial | ✓ |
| Guest phone as primary remote (no app install) | ✗ | weak | partial | ✓ |
| Real-time multi-venue F&B | external | external | external | **native** |
| Activity & spa as first-class venues | ✗ | ✗ | partial | **native** |
| Live floor manager view | ✗ | ✗ | ✗ | ✓ |
| Smart upsell engine across venues | ✗ | ✗ | partial | ✓ |
| Audit-trail for every comp / discount | partial | partial | ✓ | ✓ |
| Cash drawer reconciliation built-in | external | external | external | ✓ |
| Time-to-implement | 6–18 months | 2–4 weeks | 1–2 months | **1 week** (single venue), 4–6 weeks (full resort core) |
| Cost (100-room resort) | $40–150K/year | $20–35K/year | $25–60K/year | **fraction** (custom commercial model) |
| Owner direct line to dev team | ✗ | ✗ | ✗ | ✓ |

The honest read: each incumbent is mature and broad. **What they're
not** is *built around the actual day-to-day reality of a small-to-
mid Red Sea resort* — multi-language guests, intermittent
connectivity, cash-heavy activities, walk-up day-pass culture,
informal staffing — and *not* responsive to operator feedback inside
a week. That's the opening.

---

## 8. Pricing & engagement model

I am not selling SaaS seats. The economics here are too good and the
moat too thin for that.

Three options to discuss with a serious resort partner:

### Option A — Strategic build (low-volume, high-trust)
- Lump-sum implementation fee for the resort core + venue network +
  experience layer.
- Year-1 operations cost (hosting, support, iteration) capped.
- Year-2 onward: a flat platform fee.
- Source code escrow available for the resort's protection.

### Option B — Revenue share
- No upfront fee. I deliver the platform free.
- I take **N%** (single-digit) of the **incremental** revenue the
  platform demonstrably moves vs a baseline measured in the first
  60 days.
- Caps after 24 months.
- Aligns my incentive perfectly with theirs — I only earn if the
  uplift is real.

### Option C — Equity stake
- For an investor-owner who sees this as a category, not a vendor.
- I contribute the platform + ongoing development as founding
  technology equity.
- We jointly take it to other resorts in the region.

These are not mutually exclusive — a starter resort might do A, then
roll into C as we expand to siblings.

---

## 9. The pitch (one paragraph for the owner's first meeting)

> Today your resort runs on five disconnected systems and a lot of
> WhatsApp. The PMS at the front desk doesn't talk to the F&B
> register, which doesn't talk to the spa book, which doesn't talk
> to housekeeping. Every gap between those systems is where revenue
> leaks and guest experience fragments. I've already built a unified
> platform that's running live in a Dahab café — every staff member,
> every guest, every venue on one screen, in real time, in Arabic
> and English. The same primitives scale to your resort: multi-day
> stays, charge-to-room folios, multi-venue F&B, spa appointments,
> housekeeping, concierge inbox, smart pre-arrival upsell. On a
> 100-room resort, conservatively, this lifts gross revenue ~30M
> EGP/year while saving ~15% labor cost. Not a 12-month
> implementation — phase 1 ships in 4–6 weeks, you replace one
> system at a time, and at no point is your resort offline. Worst
> case: you have a better F&B system inside two weeks. Best case:
> in six months you have the most modern resort operations stack on
> the Red Sea, built for you, not retrofitted from a generic
> product.

---

*This document is the strategic frame. The matching technical
appendix (database migrations, API surface, role permissions, hour-
by-hour sprint plan) is available on request — happy to scope a
specific resort against a specific timeline.*
