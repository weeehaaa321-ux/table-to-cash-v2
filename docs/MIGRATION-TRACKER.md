# Migration Tracker

Every "thing in the project" gets one row. Nothing is "done" until **Verified ✅**. This is the source of truth for "did we cover the whole project."

## Status legend

- ⬜ Not started
- 🟨 In progress
- 🟦 Migrated (code moved, layer rules pass)
- ✅ Verified (characterization tests pass + preview-deploy smoke test passed)
- ⛔ Blocked (note in the Notes column)

---

## Phase 0 · Scaffolding (current)

| Item | Status | Notes |
|---|---|---|
| Inventory of source repo | ✅ | `docs/INVENTORY.md` |
| Target architecture defined | ✅ | `docs/ARCHITECTURE.md` |
| Migration tracker initialized | ✅ | this file |
| New repo git-initialized | ✅ | local only, no remote |
| Framework configs mirrored | ✅ | package.json, tsconfig, next.config, postcss, vercel.json, prisma.config, sentry configs |
| Prisma schema copied (as reference) | ✅ | `prisma/schema.prisma` — byte-identical to source |
| ESLint boundary rules configured | ✅ | uses built-in `no-restricted-imports` (no new plugin), enforces layer boundaries |
| Empty layer folders committed (.gitkeep) | ✅ | domain/application/infrastructure/presentation |
| Env-var schema documented | ✅ | `src/infrastructure/config/env.ts` — single source |
| Placeholder app boots | ✅ | `src/app/{layout,page}.tsx` minimal so framework starts |
| First `npm install` + `npm run build` runs | ⬜ | not yet exercised — needs DATABASE_URL set |

---

## Phase 1 · Deep-read questions (resolved 2026-04-26)

All 10 answered. Full findings in `INVENTORY.md` §14. Architectural implications captured in `ARCHITECTURE.md` "Updates from Phase 1 deep-read" appendix.

| Question | Status | Outcome |
|---|---|---|
| Payments processor — Stripe or cash-only? | ✅ | Cash-only · cashier-recorded `paymentMethod` · drop `PaymentProcessor` port |
| `src/lib/engine/` contents | ✅ | Coherent perception→intelligence→action pipeline · migrate as one slice into `domain/intelligence/` |
| Staff auth — pure PIN or PIN + session? | ✅ | Header-based `x-staff-id` · no JWT/cookies · single `StaffAuthenticator` port |
| Multi-tenant resolution mechanism | ✅ | 🔥 Per-deploy single-tenant · `RESTAURANT_SLUG` build-time const · drop tenant middleware |
| i18n storage rules (DB cols vs files) | ✅ | Hybrid: JSON for chrome, DB cols for content · two adapters |
| VAPID key location | ✅ | Env vars (build-time) · per-deploy = per-tenant in practice |
| Real-time mechanism | ✅ | Pure polling · visibility-aware · skip `text/event-stream` abstraction |
| `print-agent.mjs` runtime location | ✅ | Cashier's Windows PC (localhost:9911 → printer:9100) · out of architectural scope |
| Sentry data scope | ✅ | `sendDefaultPii: false` · 20% trace sample · 10% replay · port byte-identical |
| CI/CD beyond Vercel? | ✅ | None · `.github/` empty · just Vercel auto-deploy from main |

---

## Phase 2 · Domain modeling pass (no presentation yet)

Build the domain layer first — pure entities, value objects, business rules. No persistence, no UI.

| Domain | Status | Notes |
|---|---|---|
| `domain/shared/` (Identifier, Result, Money, TimeOfDayWindow, Lang) | ✅ | foundation primitives + Money value object |
| `domain/menu/AddOn`, `Category`, `MenuItem` | ✅ | with translations + time-of-day + station |
| `domain/restaurant/Restaurant`, `Table` | ✅ | single per deploy at runtime |
| `domain/order/enums` (OrderStatus state machine, PaymentMethod, OrderType, DeliveryStatus) | ✅ | |
| `domain/order/Order`, `OrderItem` | ✅ | **HOT SPOT** — money math, validateMoney() |
| `domain/session/TableSession`, `SessionRound` | ✅ | multi-round billing read model |
| `domain/staff/Staff`, `StaffPin`, `ShiftSchedule`, `StaffShift` | ✅ | StaffPin is privacy-conscious (toString redacted) |
| `domain/staff/enums` (StaffRole + isPrivileged) | ✅ | |
| `domain/delivery/DriverAssignment` (auto-assign rules) | ✅ | pure pickDriver() function |
| `domain/promo/Promo` | ✅ | applyTo(subtotal) handles PERCENTAGE/FIXED/HAPPY_HOUR |
| `domain/cashier/CashSettlement`, `CashDrawer`, `DailyClose` | ✅ | settlement state machine, drawer variance |
| `domain/messaging/Message` | ✅ | type/from/to/text/audio/command shape |
| `domain/rating/Rating` | ✅ | food/service/hygiene + averageScore() |
| `domain/vip/VipGuest` | ✅ | with linkToken + GPS pin |
| `domain/alerts/FloorAlert` (3 generators: stale_no_order, stuck_in_kitchen, waiter_imbalance) | ✅ | pure rules with thresholds |
| `domain/intelligence/types` (Insight, ItemPerformance, ItemTrend) | ✅ | |
| `domain/intelligence/analyzeItemPerformance` (+ classifyTrend, heatScore) | ✅ | pure analyzers |
| Domain unit tests (no infra) | ⬜ | not yet — needs node:test + tsx wiring |

---

## Phase 3 · Application layer (use cases + ports)

| Use case | Status | Hot spot? |
|---|---|---|
| `application/ports/Clock` interface | ✅ | |
| `application/ports/RestaurantRepository` interface | ✅ | |
| `application/ports/MenuRepository` interface | ✅ | |
| `application/ports/OrderRepository` interface | ✅ | |
| `application/ports/SessionRepository` interface | ✅ | |
| `application/ports/StaffRepository` interface | ✅ | |
| `application/ports/StaffAuthenticator` interface | ✅ | replaces session middleware |
| `application/ports/PushNotifier` interface | ✅ | |
| ~~`application/ports/PaymentProcessor` interface~~ | ⛔ removed | no payments processor in source · skip |
| `application/ports/DeliveryRepository` interface | ⬜ | not yet — DriverAssignment domain rules done |
| `application/ports/IntelligenceObserver` interface | ⬜ | not yet — pipeline glue lives in presentation hook |
| `BrowseMenuUseCase` | ✅ | with time-of-day filtering |
| `AuthenticateStaffUseCase` (loginByPin + authorizeRequest) | ✅ | 🔴 |
| `PlaceOrderUseCase` | ✅ | 🔴 server-side price authority, idempotency, station vote |
| `ManageMenuUseCase` (admin CRUD) | ⬜ | |
| `UpdateOrderStatusUseCase` | ⬜ | |
| `CancelOrderUseCase` | ⬜ | |
| `OpenSessionUseCase` | ⬜ | 🔴 |
| `AddRoundUseCase` (multi-round billing) | ⬜ | 🔴 |
| `CloseSessionUseCase` | ⬜ | 🔴 |
| `SettleCashUseCase` | ⬜ | 🔴 |
| `OpenDrawerUseCase` / `CloseDrawerUseCase` | ⬜ | 🔴 |
| `AssignDriverUseCase` | ⬜ | 🔴 |
| `UpdateDeliveryStatusUseCase` | ⬜ | |
| `EvaluateFloorAlertsUseCase` (per-minute cron) | ⬜ | |
| `AuthenticateStaffUseCase` | ⬜ | 🔴 |
| `ManageShiftsUseCase` | ⬜ | |
| `GenerateInvoiceUseCase` | ⬜ | 🔴 |
| `RunDailyCloseUseCase` | ⬜ | 🔴 |
| Use case unit tests (with fake repositories) | ⬜ | per use case |

---

## Phase 4 · Infrastructure (concrete adapters)

| Adapter | Status | Notes |
|---|---|---|
| `infrastructure/prisma/client.ts` (singleton) | ✅ | mirrors `src/lib/db.ts` pattern · global cache |
| `infrastructure/prisma/mappers/menuMappers.ts` | ✅ | Category, MenuItem, AddOn |
| `infrastructure/prisma/mappers/*` (other entities) | ⬜ | order, session, staff, delivery — pattern set |
| `infrastructure/prisma/repositories/PrismaMenuRepository` | ✅ | example impl with restaurant-id caching |
| `infrastructure/prisma/repositories/PrismaRestaurantRepository` | ⬜ | |
| `infrastructure/prisma/repositories/PrismaOrderRepository` | ⬜ | 🔴 |
| `infrastructure/prisma/repositories/PrismaSessionRepository` | ⬜ | 🔴 |
| `infrastructure/prisma/repositories/PrismaStaffRepository` | ⬜ | 🔴 |
| `infrastructure/push/WebPushNotifier` | ✅ | VAPID lazy-config · drops 404/410 subs |
| `infrastructure/time/SystemClock` | ✅ | with `nowInRestaurantTz()` |
| `infrastructure/auth/PrismaStaffAuthenticator` | ✅ | 🔴 bcrypt · same cost factor as source |
| `infrastructure/i18n/chrome.ts` | ✅ | t() + tReplace() · imports en.json + ar.json |
| `infrastructure/observability/sentry.ts` | ✅ | thin re-export · root sentry.*.config.ts copied |
| `infrastructure/config/env.ts` | ✅ | single source · serverOnly helpers throw if missing |
| `infrastructure/composition.ts` | ✅ | DI root · only place that knows both layers |
| Integration tests (real Prisma against test DB) | ⬜ | per repository |

---

## Phase 5 · Presentation layer (vertical slices, in priority order)

Each slice is a self-contained vertical: app route + API endpoints + components + integration tests + characterization tests against source.

Priority order favors low-risk slices first to validate the architecture, then progresses to hot spots once the pattern is proven.

### Slice order

| # | Slice | Risk | Status | Characterization tests | Verified |
|---|---|---|---|---|---|
| 1a | `/api/health` + `/api/version` | 🟢 | 🟦 migrated | ⬜ | ⬜ |
| 1b | `/api/clock` (clock-in/out, 4 HTTP methods) | 🟡 | ⬜ | ⬜ | ⬜ |
| 2 | `/marketing` (static pages) | 🟢 | ⬜ | ⬜ | ⬜ |
| 3 | `/api/menu` (read-only public) + `/menu` page | 🟡 | ⬜ | ⬜ | ⬜ |
| 4 | `/scan` + `/track` (guest read-only) | 🟢 | ⬜ | ⬜ | ⬜ |
| 5 | `/api/ratings` + rating UI | 🟢 | ⬜ | ⬜ | ⬜ |
| 6 | `/api/messages` | 🟡 | ⬜ | ⬜ | ⬜ |
| 7 | `/api/restaurant` (config read) | 🟡 | ⬜ | ⬜ | ⬜ |
| 8 | `/api/tables` (CRUD) + table mgmt UI | 🟡 | ⬜ | ⬜ | ⬜ |
| 9 | `/api/menu-admin` + admin menu UI | 🟡 | ⬜ | ⬜ | ⬜ |
| 10 | `/api/staff` + `/api/shifts` + `/api/schedule` | 🔴 | ⬜ | ⬜ | ⬜ |
| 11 | `/waiter` + auth flow | 🟡 | ⬜ | ⬜ | ⬜ |
| 12 | `/api/cron/shift-reminder` | 🟡 | ⬜ | ⬜ | ⬜ |
| 13 | `/api/cron/table-check` + alerts | 🟡 | ⬜ | ⬜ | ⬜ |
| 14 | `/floor` + live alerts UI | 🟡 | ⬜ | ⬜ | ⬜ |
| 15 | `/api/live-snapshot` + `/api/guest-poll` (compute hot) | 🟡 | ⬜ | ⬜ | ⬜ |
| 16 | `/kitchen` + `/bar` (KDS) | 🟡 | ⬜ | ⬜ | ⬜ |
| 17 | `/api/orders` + `/cart` + order placement | 🔴 | ⬜ | ⬜ | ⬜ |
| 18 | `/api/sessions` + table session lifecycle | 🔴 | ⬜ | ⬜ | ⬜ |
| 19 | `/api/drawer` + `/api/settlements` + cashier UI | 🔴 | ⬜ | ⬜ | ⬜ |
| 20 | `/cashier` (full UI) | 🔴 | ⬜ | ⬜ | ⬜ |
| 21 | `/api/invoice` + `/api/daily-close` | 🔴 | ⬜ | ⬜ | ⬜ |
| 22 | `/api/delivery` + `/delivery` driver UI | 🔴 | ⬜ | ⬜ | ⬜ |
| 23 | `/api/vip` + `/vip/[link]` (incl map fix) | 🔴 | ⬜ | ⬜ | ⬜ |
| 24 | `/dashboard` + `/api/analytics` + `/api/export` | 🟡 | ⬜ | ⬜ | ⬜ |
| 25 | `/api/push` + `/api/clear` (destructive) | 🔴 | ⬜ | ⬜ | ⬜ |
| 26 | Intelligence engine (`src/lib/engine/*` → `domain/intelligence/`) | 🟡 | ⬜ | ⬜ | ⬜ |

---

## Phase 6 · Scripts

| Script | Status | Move to | Notes |
|---|---|---|---|
| `scripts/auto-tag-items.ts` | ⬜ | `scripts/` (kept at root) | One-off; don't refactor |
| `scripts/backfill-staff-codes.ts` | ⬜ | same | 🔴 staff identity |
| `scripts/check-*.ts` (5 files) | ⬜ | same | Audits, leave as-is |
| `scripts/cleanup-old-categories.ts` | ⬜ | same | Data |
| `scripts/clear-data.ts` | ⬜ | same | 🔴 destructive — guard env |
| `scripts/create-owner.ts` | ⬜ | same | 🔴 identity |
| `scripts/debug-tags.ts` | ⬜ | same | |
| `scripts/load-test.mjs` | ⬜ | same | Load testing |
| `scripts/menu-analysis.ts` | ⬜ | same | Reporting |
| `scripts/print-agent.mjs` | ⬜ | same | Print client |
| `scripts/refactor-palette.sh` | ⬜ | drop (one-off) | |
| `scripts/rename-restaurant.ts` | ⬜ | same | Tenant ops |
| `scripts/seed-*.ts` (3 files) | ⬜ | same | Seeders |

---

## Phase 7 · Cutover

| Step | Status | Notes |
|---|---|---|
| Parallel-run period (2 weeks) | ⬜ | v2 deployed to preview, source repo serves prod |
| Behavior delta verified zero | ⬜ | compare logs + DB writes |
| DNS / Vercel project pointed to v2 | ⬜ | |
| Source repo archived (not deleted) | ⬜ | tag final commit |
| `MIGRATION-COMPLETE.md` written | ⬜ | post-mortem doc |

---

## Hot-spot guard rails (cross-cutting)

These checks run at every slice migration that touches a hot spot, in addition to the per-slice verification:

- [ ] **Money math** — `Money` value object used everywhere; no raw `Number` for amounts; NUMERIC(10,2) preserved
- [ ] **Auth** — PIN flow byte-identical; bcrypt round-count preserved
- [ ] **DB connection** — Prisma client singleton; connection pool not regressed
- [ ] **Cron timing** — schedules in `vercel.json` unchanged
- [ ] **Polling intervals** — preserve recent Neon-burn optimizations
- [ ] **RTL/LTR parity** — every UI slice tested in both
- [ ] **i18n** — EN/AR/RU strings preserved; DB translation cols read correctly

---

## How to update this file

When you start a slice: change ⬜ → 🟨 and date-stamp it.
When code is moved: 🟨 → 🟦.
When characterization tests + preview deploy pass: 🟦 → ✅.
If something breaks: ⛔ with a one-line note.

The tracker is the answer to "is the migration covering the whole project, or just the easy bits?"
