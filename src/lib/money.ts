// Money interop helpers. The DB stores money as NUMERIC(10,2) and Prisma
// returns those columns as `Prisma.Decimal` instances. Almost every API
// response and aggregation in the codebase wants to treat money as a
// plain `number` (toLocaleString, +, reduce, JSON), so we coerce at
// every boundary using these helpers. The conversion is loss-free
// because all stored values are bounded to 2 decimals.

import { Prisma } from "@/generated/prisma/client";

type MaybeDecimal = Prisma.Decimal | number | null | undefined;

// Coerce a Prisma.Decimal (or number / null) to a plain JS number.
// Null/undefined fold to 0 because the only fields that are nullable
// here (CashDrawer.closingCount/expectedCash/variance) all imply 0
// when absent in the contexts we read them in.
export function toNum(d: MaybeDecimal): number {
  if (d == null) return 0;
  if (typeof d === "number") return d;
  return d.toNumber();
}

// Variant that preserves null instead of folding to 0. Used where the
// distinction "not yet set" vs "set to zero" matters (e.g. drawer
// variance — null means open, 0 means closed-and-balanced).
export function toNumOrNull(d: MaybeDecimal): number | null {
  if (d == null) return null;
  if (typeof d === "number") return d;
  return d.toNumber();
}
