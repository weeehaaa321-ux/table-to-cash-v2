# Target Architecture

Layered architecture. Each layer has explicit responsibilities and explicit rules about what it may import. The migration is a re-housing of existing code into these layers — not a rewrite.

---

## The four layers

```
┌─────────────────────────────────────────────────────┐
│  Presentation                                       │  ← Next.js pages, API route handlers, components
│  (knows: HTTP, React, browser, framework)           │
├─────────────────────────────────────────────────────┤
│  Application                                        │  ← Use cases, orchestration
│  (knows: domain + infrastructure interfaces)        │
├─────────────────────────────────────────────────────┤
│  Domain                                             │  ← Pure business logic, value objects, rules
│  (knows: nothing outside itself)                    │
├─────────────────────────────────────────────────────┤
│  Infrastructure                                     │  ← Prisma, Stripe, web-push, Leaflet, fetch
│  (implements interfaces declared by domain/app)     │
└─────────────────────────────────────────────────────┘
```

Layer rules (enforced by file structure + ESLint import rules):

| Layer | May import from | May NOT import from |
|---|---|---|
| Domain | nothing (only stdlib types) | application, infrastructure, presentation, framework |
| Application | domain, infrastructure interfaces | presentation, concrete infrastructure |
| Infrastructure | domain, application interfaces | presentation |
| Presentation | application, domain (read-only types) | infrastructure directly |

> The presentation layer never reaches into Prisma, Stripe, etc. directly. It calls a use case from the application layer; the use case orchestrates infrastructure via interfaces. This is what makes the code testable, swappable, and resistant to framework version changes.

---

## Folder structure

```
src/
├── domain/                        ← Pure business logic
│   ├── restaurant/
│   │   ├── Restaurant.ts          ← Entity / aggregate root
│   │   ├── Table.ts
│   │   └── value-objects/
│   ├── menu/
│   │   ├── MenuItem.ts
│   │   ├── Category.ts
│   │   ├── AddOn.ts
│   │   └── Money.ts               ← Decimal money type, all math
│   ├── order/
│   │   ├── Order.ts
│   │   ├── OrderItem.ts
│   │   ├── OrderStatus.ts
│   │   └── rules/                 ← e.g. order-state-machine
│   ├── session/
│   │   ├── TableSession.ts
│   │   └── SessionRound.ts        ← Multi-round billing rules
│   ├── staff/
│   │   ├── Staff.ts
│   │   ├── StaffPin.ts
│   │   └── ShiftSchedule.ts
│   ├── delivery/
│   │   ├── Delivery.ts
│   │   ├── Driver.ts
│   │   └── DriverAssignment.ts
│   ├── alerts/
│   │   └── FloorAlert.ts
│   └── shared/                    ← Cross-domain primitives
│       ├── Identifier.ts
│       ├── DateTimeRange.ts
│       └── Result.ts
│
├── application/                   ← Use cases (orchestration)
│   ├── menu/
│   │   ├── BrowseMenuUseCase.ts
│   │   └── ManageMenuUseCase.ts
│   ├── order/
│   │   ├── PlaceOrderUseCase.ts
│   │   ├── UpdateOrderStatusUseCase.ts
│   │   └── CancelOrderUseCase.ts
│   ├── session/
│   │   ├── OpenSessionUseCase.ts
│   │   ├── AddRoundUseCase.ts
│   │   └── CloseSessionUseCase.ts
│   ├── cashier/
│   │   ├── SettleCashUseCase.ts
│   │   ├── OpenDrawerUseCase.ts
│   │   └── CloseDrawerUseCase.ts
│   ├── delivery/
│   │   ├── AssignDriverUseCase.ts
│   │   └── UpdateDeliveryStatusUseCase.ts
│   ├── alerts/
│   │   └── EvaluateFloorAlertsUseCase.ts
│   ├── staff/
│   │   ├── AuthenticateStaffUseCase.ts
│   │   └── ManageShiftsUseCase.ts
│   └── ports/                     ← Interfaces infrastructure must implement
│       ├── RestaurantRepository.ts
│       ├── OrderRepository.ts
│       ├── PushNotifier.ts
│       ├── PaymentProcessor.ts
│       └── Clock.ts
│
├── infrastructure/                ← Concrete impls of ports
│   ├── prisma/
│   │   ├── client.ts              ← Singleton (current: src/lib/db.ts)
│   │   ├── repositories/
│   │   │   ├── PrismaOrderRepository.ts
│   │   │   ├── PrismaSessionRepository.ts
│   │   │   └── ...                ← One per port
│   │   └── mappers/               ← Prisma row → Domain entity
│   ├── push/
│   │   └── WebPushNotifier.ts     ← Implements PushNotifier port
│   ├── payments/
│   │   └── (Stripe/etc when introduced)
│   ├── time/
│   │   └── SystemClock.ts         ← Implements Clock port
│   ├── i18n/
│   │   └── translations.ts        ← Translation strings
│   ├── auth/
│   │   └── PinAuthenticator.ts    ← Bcrypt-based PIN
│   ├── observability/
│   │   ├── sentry.ts
│   │   └── instrumentation.ts
│   └── config/
│       └── env.ts                 ← Env var validation (single source)
│
└── presentation/                  ← Next.js
    ├── app/                       ← Mirrors current src/app/*
    │   ├── (guest)/
    │   │   ├── menu/page.tsx
    │   │   ├── cart/page.tsx
    │   │   ├── track/page.tsx
    │   │   └── scan/page.tsx
    │   ├── (staff)/
    │   │   ├── waiter/page.tsx
    │   │   ├── cashier/page.tsx
    │   │   ├── kitchen/page.tsx
    │   │   ├── bar/page.tsx
    │   │   ├── floor/page.tsx
    │   │   └── delivery/page.tsx
    │   ├── (owner)/
    │   │   └── dashboard/page.tsx
    │   ├── vip/[link]/page.tsx
    │   ├── marketing/page.tsx
    │   └── api/                   ← Route handlers, thin
    │       ├── orders/route.ts
    │       └── ...
    ├── components/                ← UI components
    │   ├── ui/                    ← Design-system primitives
    │   ├── guest/
    │   ├── cashier/
    │   ├── kitchen/
    │   ├── floor/
    │   └── dashboard/
    ├── hooks/                     ← React hooks
    │   ├── useLanguage.ts
    │   ├── useLiveData.ts
    │   └── useCashierReliability.ts
    └── stores/                    ← Zustand stores
```

---

## How a feature flows top-to-bottom

**Example: guest places an order**

1. **Presentation** — `src/presentation/app/(guest)/cart/page.tsx` collects cart state, posts to `/api/orders`.
2. **Presentation** — `src/presentation/app/api/orders/route.ts` is a thin handler. It validates HTTP shape, extracts the request, and calls `PlaceOrderUseCase.execute(input)`.
3. **Application** — `PlaceOrderUseCase` orchestrates: load menu items via `MenuItemRepository`, compute total via `Order.calculateTotal()` (domain), persist via `OrderRepository.save()`, fire `PushNotifier.notifyKitchen()`.
4. **Domain** — `Order.calculateTotal()` uses `Money` value object for decimal math. Pure function. No framework.
5. **Infrastructure** — `PrismaOrderRepository.save()` maps the domain `Order` to a Prisma row and writes it. `WebPushNotifier.notifyKitchen()` calls the web-push library.

Result: business logic is testable without spinning up Next.js or Prisma. Framework versions can change without touching domain code.

---

## Naming conventions

| Concept | Convention | Example |
|---|---|---|
| Entity / aggregate | PascalCase noun | `Order`, `MenuItem` |
| Value object | PascalCase noun | `Money`, `OrderStatus`, `StaffPin` |
| Use case | PascalCase + `UseCase` suffix | `PlaceOrderUseCase` |
| Port (interface) | PascalCase noun, in `application/ports/` | `OrderRepository`, `PushNotifier` |
| Adapter (impl) | PascalCase + tech prefix | `PrismaOrderRepository`, `WebPushNotifier` |
| Hook | `use` prefix camelCase | `useLanguage` |
| Component | PascalCase | `MenuItemCard` |
| Constant | UPPER_SNAKE | `MAX_TABLE_COUNT` |

---

## Rules with teeth

These get enforced via ESLint `eslint-plugin-import` and `eslint-plugin-boundaries`:

1. **No framework imports in `domain/`** — `import { ... } from 'next/...'` in a domain file is a build error.
2. **No Prisma imports in `application/`** — application talks to ports, not concrete Prisma. Build error otherwise.
3. **No infrastructure-to-presentation imports** — infrastructure is leaf-level.
4. **No cross-feature imports inside a layer** — e.g. `domain/order/*` cannot import from `domain/menu/*`. Cross-feature coordination happens in `application/`.
5. **No raw `Number` for money** — money lives in the `Money` value object, always.
6. **No `Date` directly in business logic** — use `Clock` port so tests can fake time.
7. **No `process.env.X` outside `infrastructure/config/env.ts`** — single source of env validation.

---

## What's deliberately not changing

The following stays exactly as in source repo:

- **Prisma schema** — `prisma/schema.prisma` migrated as-is. Domain entities map onto existing schema via mappers in `infrastructure/prisma/mappers/`. No DB migration as part of restructure.
- **Public API contract** — `/api/*` route shapes (request + response JSON) byte-identical to source. Characterization tests lock this.
- **Env vars** — same names, same shapes. Validated in one place but not renamed.
- **Cron schedules** — `vercel.json` copied verbatim.
- **Auth mechanism** — PIN-based with bcrypt stays. The implementation moves into `infrastructure/auth/PinAuthenticator.ts` but the algorithm is identical.

---

## Why these choices (briefly)

- **Layered + ports/adapters** rather than feature-folders alone, because the codebase has real cross-cutting concerns (money, identity, real-time data) that benefit from explicit layer boundaries.
- **Domain layer pure (no framework)** because Next.js 16 is changing fast (per `AGENTS.md`); business logic should outlive framework versions.
- **One place for env vars** because the current scattering of `process.env.X` makes it impossible to know the full surface.
- **Mappers between Prisma and domain** because Prisma rows and domain entities don't always have to be 1:1 — the entity is the canonical shape.
- **Folder-by-feature inside each layer** (domain/order/, domain/menu/, etc.) so when you open the domain folder you see the business, not technical concerns.

---

## What this architecture does NOT solve

Be honest about limits:

- It doesn't make the app faster. Optimization is a separate phase per slice.
- It doesn't fix existing bugs. Characterization tests preserve them; bug fixes are explicit follow-up commits.
- It doesn't reduce file count. Layered architecture adds files (mappers, ports, use cases). The trade is more files for clearer boundaries and easier change.
- It doesn't replace good test coverage. Layer rules make tests easier to write, but you still have to write them.
