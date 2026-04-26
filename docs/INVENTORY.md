# Source Repo Inventory

> Read-only catalog of everything in `E:\table-to-cash` as of 2026-04-26. This is the map. Migration order in `MIGRATION-TRACKER.md` derives from this.

---

## 1. Stack

| Layer | Tech | Version |
|---|---|---|
| Framework | Next.js (app router) | 16.2.2 |
| UI | React | 19.2.4 |
| Styling | TailwindCSS | 4.x |
| Language | TypeScript (strict) | 5.x |
| Database | PostgreSQL via Neon | — |
| ORM | Prisma | 7.6.0 |
| State | Zustand | 5.0.x |
| Maps | Leaflet + react-leaflet | 1.9 / 5.0 |
| Notifications | web-push | 3.6.x |
| Animation | framer-motion | 12.38 |
| Auth helpers | bcryptjs | 3.0.x |
| QR | qrcode | 1.5.x |
| Monitoring | Sentry (Next.js) | 10.48 |
| Hosting | Vercel | — |
| Cron | Vercel Cron | — |

> **Important:** per `AGENTS.md`, this is Next.js 16.x with breaking changes from prior versions. Migrating code requires reading `node_modules/next/dist/docs/` for current API patterns. Don't assume Next.js 13/14/15 conventions.

---

## 2. Personas / user roles

| Role | Entry point | Primary purpose |
|---|---|---|
| Guest (dine-in) | `/scan` → `/menu` → `/cart` → `/track` | QR ordering, status tracking, rating |
| Guest (VIP delivery) | `/vip/[link]` | Personal-link delivery ordering |
| Waiter | `/waiter` (PIN auth) | See assigned tables, get food-ready notifications |
| Cashier | `/cashier` (PIN auth) | Bills, payments, cash drawer |
| Kitchen | `/kitchen` | KDS — food orders ready to prep |
| Bar | `/bar` | KDS — drinks orders only |
| Floor manager | `/floor` | Live floor map, alerts, command bridge |
| Owner / admin | `/dashboard` | Full operations, analytics, staff, menu admin |
| Delivery driver | `/delivery` | Assigned orders, route, status |
| Marketing visitor | `/marketing` | Public marketing pages |

---

## 3. Top-level structure

```
table-to-cash/
├── src/
│   ├── app/             # Next.js app router (12 user-facing routes + api/)
│   ├── components/      # Shared React components (6 feature groups)
│   ├── lib/             # Business logic + utilities (28 modules + engine/)
│   ├── store/           # Zustand stores
│   ├── i18n/            # Translation strings
│   ├── types/           # Shared TypeScript types
│   ├── generated/       # Prisma client output (.gitignored target)
│   └── instrumentation.ts  # Sentry instrumentation
├── prisma/
│   ├── schema.prisma    # Database schema (~16k chars)
│   ├── seed.ts          # Seed data
│   └── migrations/      # Migration history
├── scripts/             # 18+ ops & data scripts (TS + sh + mjs)
├── public/              # Static assets
├── instrumentation.ts   # Root Sentry instrumentation
├── sentry.{client,server,edge}.config.ts
├── next.config.ts
├── prisma.config.ts
├── tsconfig.json (paths: @/* → ./src/*)
├── eslint.config.mjs
├── postcss.config.mjs
├── vercel.json (2 cron jobs)
└── package.json
```

---

## 4. App routes (`src/app/*`)

12 user-facing routes plus `api/` endpoints. Each is its own folder under `src/app/`.

| Route | Persona | Risk* | Notes |
|---|---|---|---|
| `/` (page.tsx) | All | 🟢 low | Landing page |
| `/marketing` | Public | 🟢 low | Marketing site |
| `/scan` | Guest | 🟡 medium | QR landing, redirects to menu+session |
| `/menu` | Guest | 🟡 medium | Browse menu, add to cart |
| `/cart` | Guest | 🔴 high | Order submission, money |
| `/track` | Guest | 🟢 low | Order status polling |
| `/waiter` | Waiter | 🟡 medium | PIN auth, table view |
| `/cashier` | Cashier | 🔴 high | Money math, drawer, settlements |
| `/kitchen` | Kitchen | 🟡 medium | Order display, status updates |
| `/bar` | Bar | 🟡 medium | Drinks-only KDS |
| `/floor` | Floor mgr | 🟡 medium | Live map, alerts |
| `/dashboard` | Owner | 🟡 medium | Analytics, admin, large surface |
| `/delivery` | Driver | 🟡 medium | Map, assigned orders |
| `/vip/[link]` | VIP guest | 🔴 high | Map pin (recent crash bug), money |
| `error.tsx` `global-error.tsx` | All | 🟢 low | Error boundaries |
| `layout.tsx` | All | 🟢 low | Root layout |
| `robots.ts` `sitemap.ts` `globals.css` | — | 🟢 low | Static |

*Risk = blast radius if a regression slips through. Money + identity = 🔴 high.

---

## 5. API routes (`src/app/api/*`)

25 endpoint groups. Each is a Next.js route handler folder.

| Endpoint | Risk | Surface |
|---|---|---|
| `/api/analytics` | 🟡 | Dashboard reports |
| `/api/clear` | 🔴 | Clears data (destructive — protect) |
| `/api/clock` | 🟢 | Server time |
| `/api/cron/*` | 🟡 | `shift-reminder` (30min), `table-check` (1min) |
| `/api/daily-close` | 🔴 | End-of-day close, money rollup |
| `/api/delivery` | 🔴 | Driver assignment, money on delivery |
| `/api/drawer` | 🔴 | Cash drawer ops |
| `/api/export` | 🟡 | Data export (privacy surface) |
| `/api/guest-poll` | 🟢 | High-volume poll endpoint (compute hot spot — see git log) |
| `/api/health` | 🟢 | Health check |
| `/api/invoice` | 🔴 | Invoice generation |
| `/api/live-snapshot` | 🟡 | Live-data snapshot for SSE/poll |
| `/api/menu` | 🟢 | Public menu read |
| `/api/menu-admin` | 🟡 | Menu CRUD (admin auth) |
| `/api/messages` | 🟡 | Internal messaging |
| `/api/orders` | 🔴 | Order CRUD — recently locked for price spoofing |
| `/api/push` | 🟡 | Web push subscribe/send |
| `/api/ratings` | 🟢 | Guest ratings |
| `/api/restaurant` | 🟡 | Restaurant config |
| `/api/schedule` | 🟡 | Shift scheduling |
| `/api/sessions` | 🔴 | Table sessions, ties to money |
| `/api/settlements` | 🔴 | Cash settlements |
| `/api/shifts` | 🟡 | Staff shifts |
| `/api/staff` | 🔴 | Staff CRUD, identity (PIN) |
| `/api/tables` | 🟡 | Table CRUD |
| `/api/version` | 🟢 | Build ID |
| `/api/vip` | 🔴 | VIP delivery (recent map bug) |

---

## 6. Library modules (`src/lib/*`)

28 modules + an `engine/` subdir.

| Module | Risk | Purpose |
|---|---|---|
| `api-auth.ts` | 🔴 | Server-side auth helpers — protect during migration |
| `db.ts` | 🔴 | Prisma client singleton — singleton pattern matters |
| `money.ts` | 🔴 | All money math — recently hardened to NUMERIC(10,2) |
| `staff-code.ts` | 🔴 | PIN handling, identity |
| `engine/` | 🟡 | Business engine logic (subdir — needs deeper read) |
| `delivery-assignment.ts` | 🔴 | Driver auto-assignment |
| `floor-alerts.ts` | 🟡 | Smart alerts logic |
| `kitchen-config.ts` | 🟡 | Per-restaurant kitchen routing |
| `notifications.ts` | 🟡 | Push + in-app notifications |
| `order-label.ts` | 🟢 | Order display labels |
| `placeholders.ts` | 🟢 | Loading placeholders |
| `polling.ts` | 🟡 | Live-data polling (Neon-burn-sensitive — see git log) |
| `promotions.ts` | 🟡 | Promo logic |
| `push-client.ts` | 🟡 | Browser-side push helpers |
| `queries.ts` | 🟡 | Common Prisma queries (potential N+1 hot spot) |
| `receipt-image.ts` | 🟡 | Receipt rendering |
| `restaurant-config.ts` | 🟡 | Per-restaurant config |
| `schedule-sync.ts` | 🟡 | Schedule synchronization |
| `self-move.ts` | 🟡 | (recent untracked — needs reading) |
| `session-rounds.ts` | 🔴 | Multi-round billing logic |
| `shifts.ts` | 🟡 | Shift business rules |
| `staff-fetch.ts` | 🟡 | Staff retrieval helpers |
| `translate-notes.ts` | 🟢 | i18n note translation |
| `upsell.ts` | 🟢 | Upsell suggestions |
| `use-cashier-reliability.ts` | 🟡 | Hook — cashier connection state |
| `use-language.ts` | 🟢 | Hook — language pref |
| `use-live-data.ts` | 🟡 | Hook — live data subscription |
| `waiter-transfer.ts` | 🟡 | Transfer table between waiters |
| `web-push.ts` | 🟡 | Server-side push send |

---

## 7. Components (`src/components/*`)

6 feature groups.

| Group | Persona |
|---|---|
| `cart/` | Guest |
| `cashier/` | Cashier |
| `dashboard/` | Owner |
| `floor/` | Floor manager |
| `menu/` | Guest |
| `ui/` | Shared design-system primitives |

---

## 8. Domain models (`prisma/schema.prisma`)

~17 models. Key ones (read first ~120 lines of schema; full deep-read needed for migration):

- **Restaurant** — top-level tenant. Has `kitchenConfig` JSON, `waiterCapacity`, currency, timezone, slug, logo
- **Table** — per restaurant, `(restaurantId, number)` unique, has QR
- **Category** — has time-of-day window (`availableFromHour/ToHour`), `station` (KITCHEN/BAR), translations EN/AR/RU
- **MenuItem** — translations, hours, `pairsWith` (upsell), tags, `bestSeller`/`highMargin`/`available`, `Decimal(10,2)` price (recently hardened)
- **AddOn** — per menu item
- **Order** — `OrderStatus` enum, ties to Table + Restaurant
- **TableSession** — ongoing dining session, money rollup
- **Staff** — PIN auth
- **Promo** — discount codes
- **Message** — internal messaging
- **PushSubscription** — web-push subs
- **CashSettlement** — settled cash transactions
- **CashDrawer** — physical drawer state
- **Rating** — guest ratings
- **VipGuest** — VIP delivery customer
- **ShiftSchedule** — staff scheduling

> Full schema read required during Phase 1 to catalog all models, relations, enums, indexes.

---

## 9. Cron jobs (`vercel.json`)

| Schedule | Path | Purpose |
|---|---|---|
| `*/30 * * * *` | `/api/cron/shift-reminder` | Notify staff of upcoming shifts |
| `* * * * *` | `/api/cron/table-check` | Per-minute table state check (alert generation) |

Per-minute cron is a compute hot spot. Verify behavior carefully on migration.

---

## 10. Scripts (`scripts/*`)

Operational + data scripts. Not part of runtime, but live in the repo.

| Script | Purpose |
|---|---|
| `auto-tag-items.ts` | Tag menu items |
| `backfill-staff-codes.ts` | Backfill PIN codes |
| `check-breakfast-hours.ts` | Verify time-of-day config |
| `check-categories.ts` | Audit categories |
| `check-loadtest-data.ts` | Inspect load-test seeded data |
| `check-prod-slug.ts` | Verify production restaurant slug |
| `check-tags.ts` | Tag audit |
| `cleanup-old-categories.ts` | Data cleanup |
| `clear-data.ts` | Destructive — clears restaurant data |
| `create-owner.ts` | Create new owner account |
| `debug-tags.ts` | Tag debugging |
| `load-test.mjs` | Load testing harness |
| `menu-analysis.ts` | Menu analytics |
| `print-agent.mjs` | Receipt print agent |
| `refactor-palette.sh` | Color palette refactor (shell) |
| `rename-restaurant.ts` | Rename restaurant tenant |
| `seed-food-menu.ts` | Seed food menu |
| `seed-menu.ts` | Seed default menu |
| `seed-tables-50.ts` | Seed 50 tables for load-test |

---

## 11. External integrations

| Integration | Purpose | Risk |
|---|---|---|
| Neon Postgres (serverless) | Database | 🔴 |
| Vercel | Hosting + cron | 🔴 |
| Sentry | Error monitoring | 🟡 |
| Web Push (VAPID) | Push notifications | 🟡 |
| Leaflet + OpenStreetMap | Map rendering | 🟡 |
| Unsplash | Remote images (next.config allowlist) | 🟢 |
| Print agent | Receipt printing (`print-agent.mjs`) | 🟡 |

> **Not yet verified — needs check during Phase 1**: Stripe / payments processor integration (referenced in marketing strategy docs but not seen in lib/ — may not exist yet, or may exist in api/orders or api/sessions).

---

## 12. Hot spots — extra care during migration

These are the things where a regression is most expensive (money, identity, trust).

| File / surface | Why it's a hot spot |
|---|---|
| `src/lib/money.ts` | All money math. Recently hardened (NUMERIC(10,2), spoofing fix). |
| `src/lib/api-auth.ts` | Server-side auth — touch carefully |
| `src/lib/staff-code.ts` | PIN handling — identity |
| `src/lib/db.ts` | Singleton Prisma client — connection pool sensitive |
| `src/app/api/orders/*` | Order CRUD — recently price-locked |
| `src/app/api/sessions/*` | Money rollup |
| `src/app/api/settlements/*` | Cash settlements |
| `src/app/api/drawer/*` | Cash drawer |
| `src/app/api/daily-close/*` | End-of-day close — large blast radius |
| `src/app/api/delivery/*` | Money on delivery |
| `src/app/api/clear/*` | Destructive op — guard rail |
| `src/app/vip/[link]/*` | Recent map crash bug — fix was reverted, may still be broken |
| `src/app/api/cron/table-check/*` | Per-minute cron — compute cost |
| `src/lib/polling.ts` | Recently optimized for Neon burn — easy to regress |

---

## 13. Recent activity (from `git log -5`)

Signals about what's in flux:

```
3e6f6c5 Lock money endpoints, kill price/total spoofing, move money to NUMERIC(10,2)
e4e904d Revert "VIP delivery: fix map crash when opening Location Pin"
6e10f46 VIP delivery: fix map crash when opening Location Pin    (REVERTED)
f0a2870 Cut Neon compute burn: stretch poll intervals, guard load-test scripts
627ae2c Staff headers: fix kebab dropdown clipping in RTL
```

Implications:
- Money endpoints were just hardened — **freeze them in v2 at the post-hardening state**, do not "improve."
- VIP delivery map pin still likely broken (fix reverted) — capture the broken state in characterization tests so v2 doesn't accidentally "fix" it without intent.
- Compute optimization is recent and ongoing — preserve the polling intervals, do not regress.
- RTL support is active — every UI slice must verify RTL/LTR parity.

---

## 14. Open questions / unknowns

These need resolving before migration starts. Listed by priority.

1. **Payments processor** — is there a Stripe/PayMob/MyFatoorah integration somewhere, or are payments cash-only currently? Search `src/app/api/` for webhook handlers, search `src/lib/` for SDK imports.
2. **Engine subdir** — `src/lib/engine/` not yet read. What's in there?
3. **Staff auth flow** — is it pure PIN, or PIN + JWT/session cookie? Check `src/lib/api-auth.ts`.
4. **Multi-tenant model** — every model has `restaurantId`. Is tenant resolution by subdomain, slug-in-URL, header, or session? Important for the auth layer in target architecture.
5. **i18n storage** — translations in `src/i18n/` only, or also in DB (e.g. `Category.nameAr`, `MenuItem.nameAr`)? Both, but rules between them?
6. **Web push VAPID keys** — env-only, or also in DB? Tenant-specific or global?
7. **Real-time data** — `live-snapshot` + `polling` suggests poll-based. Is there SSE or websocket anywhere, or pure polling?
8. **Print agent** — `scripts/print-agent.mjs` runs where? On the cafe's local machine, or server-side?
9. **Sentry** — what data is sent? Any PII concerns to preserve?
10. **Build outputs** — `build-output.txt`, `prisma_err.txt` in root suggest manual build/migration debugging. Anything else doing CI/CD beyond Vercel?

---

## 15. Out of scope for v2

These deliberately stay in the source repo (not migrated):

- Marketing docs (`GOOGLE-ADS-STRATEGY.md`, `CAMPAIGN-PLAN-2026.html`, `SALES-PLAYBOOK.html`, `NEOM-PROPOSAL.md`, etc.) — they're business documents, not code
- Onboarding docs (`ONBOARDING-DEVELOPER.txt`, `ONBOARDING-TESTER.txt`)
- `WHAT-IF-SCENARIOS.txt`, `SCALE-READINESS.md`, `CHANGELOG.md` — operational notes
- `images.jfif`, `memory ttc`, `build-output.txt`, `prisma_err.txt` — incidental files

A separate `docs/` folder in v2 may eventually hold migrated/condensed versions of operational docs, but not as part of the architectural migration.
