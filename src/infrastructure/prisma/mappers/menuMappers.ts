// ─────────────────────────────────────────────────────────────────
// Prisma row → Domain entity mappers for the menu module.
//
// Each mapper takes a raw Prisma row and constructs the corresponding
// domain entity via its `rehydrate` static. Money is converted from
// Prisma's Decimal at this seam.
// ─────────────────────────────────────────────────────────────────

import { Money } from "@/domain/shared/Money";
import { Category } from "@/domain/menu/Category";
import { MenuItem } from "@/domain/menu/MenuItem";
import { AddOn } from "@/domain/menu/AddOn";
import type { Station } from "@/domain/menu/Category";
import { makeId } from "@/domain/shared/Identifier";

export function mapCategory(row: {
  id: string;
  name: string;
  nameAr: string | null;
  nameRu: string | null;
  slug: string;
  sortOrder: number;
  icon: string | null;
  station: string;
  availableFromHour: number | null;
  availableToHour: number | null;
}): Category {
  return Category.rehydrate({
    id: makeId<"Category">(row.id),
    slug: row.slug,
    name: row.name,
    nameAr: row.nameAr,
    nameRu: row.nameRu,
    station: row.station as Station,
    sortOrder: row.sortOrder,
    icon: row.icon,
    availableFromHour: row.availableFromHour,
    availableToHour: row.availableToHour,
  });
}

export function mapMenuItem(row: {
  id: string;
  name: string;
  nameAr: string | null;
  nameRu: string | null;
  description: string | null;
  descAr: string | null;
  descRu: string | null;
  price: { toString(): string };
  image: string | null;
  available: boolean;
  bestSeller: boolean;
  highMargin: boolean;
  calories: number | null;
  prepTime: number | null;
  sortOrder: number;
  availableFromHour: number | null;
  availableToHour: number | null;
  categoryId: string;
  pairsWith: string[];
  tags: string[];
  views: number;
}): MenuItem {
  return MenuItem.rehydrate({
    id: makeId<"MenuItem">(row.id),
    categoryId: makeId<"Category">(row.categoryId),
    name: row.name,
    nameAr: row.nameAr,
    nameRu: row.nameRu,
    description: row.description,
    descAr: row.descAr,
    descRu: row.descRu,
    price: Money.fromDecimalLike(row.price),
    image: row.image,
    available: row.available,
    bestSeller: row.bestSeller,
    highMargin: row.highMargin,
    calories: row.calories,
    prepTime: row.prepTime,
    sortOrder: row.sortOrder,
    availableFromHour: row.availableFromHour,
    availableToHour: row.availableToHour,
    tags: row.tags,
    pairsWith: row.pairsWith.map((id) => makeId<"MenuItem">(id)),
    views: row.views,
  });
}

export function mapAddOn(row: {
  id: string;
  name: string;
  price: { toString(): string };
  menuItemId: string;
}): AddOn {
  return AddOn.rehydrate({
    id: makeId<"AddOn">(row.id),
    menuItemId: makeId<"MenuItem">(row.menuItemId),
    name: row.name,
    price: Money.fromDecimalLike(row.price),
  });
}
