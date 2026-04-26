// AI-powered upsell engine — rules-based for MVP, swap for ML later

type UpsellRule = {
  trigger: string[]; // tags on the item being added
  suggest: string[]; // tags to look for in suggestions
  message: string;
};

const PAIRING_RULES: UpsellRule[] = [
  {
    trigger: ["seafood", "fish", "shrimp"],
    suggest: ["white-wine", "wine"],
    message: "Perfect with a chilled white wine?",
  },
  {
    trigger: ["steak", "meat", "burger"],
    suggest: ["red-wine", "beer"],
    message: "Pairs beautifully with a cold beer",
  },
  {
    trigger: ["coffee", "espresso"],
    suggest: ["dessert", "pastry", "cake"],
    message: "Add something sweet?",
  },
  {
    trigger: ["dessert", "cake", "pastry"],
    suggest: ["coffee", "tea"],
    message: "Complete it with a fresh coffee",
  },
  {
    trigger: ["breakfast", "eggs"],
    suggest: ["juice", "smoothie"],
    message: "Start fresh with a juice?",
  },
  {
    trigger: ["pizza", "pasta"],
    suggest: ["salad", "appetizer"],
    message: "Start with a fresh salad?",
  },
  {
    trigger: ["main", "entree"],
    suggest: ["appetizer", "starter"],
    message: "While you wait — try our starters",
  },
  {
    trigger: ["drink", "cocktail", "juice"],
    suggest: ["snack", "appetizer", "sharing"],
    message: "Something to nibble on?",
  },
];

export type UpsellSuggestion = {
  itemId: string;
  message: string;
  type: "pairing" | "popular" | "chef" | "idle";
};

type MenuItem = {
  id: string;
  tags: string[];
  bestSeller: boolean;
  highMargin: boolean;
  price: number;
  categoryId: string;
};

export function getUpsellSuggestions(
  addedItem: MenuItem,
  allItems: MenuItem[],
  cartItemIds: string[]
): UpsellSuggestion[] {
  const suggestions: UpsellSuggestion[] = [];
  const inCart = new Set(cartItemIds);

  // 1. Rule-based pairings
  for (const rule of PAIRING_RULES) {
    const matches = rule.trigger.some((t) => addedItem.tags.includes(t));
    if (!matches) continue;

    const candidates = allItems.filter(
      (item) =>
        !inCart.has(item.id) &&
        item.id !== addedItem.id &&
        rule.suggest.some((s) => item.tags.includes(s))
    );

    if (candidates.length > 0) {
      // Prefer high-margin items
      const pick =
        candidates.find((c) => c.highMargin) ||
        candidates[Math.floor(Math.random() * candidates.length)];
      suggestions.push({
        itemId: pick.id,
        message: rule.message,
        type: "pairing",
      });
    }
  }

  // 2. Best sellers from different category
  if (suggestions.length < 2) {
    const bestSellers = allItems.filter(
      (item) =>
        item.bestSeller &&
        !inCart.has(item.id) &&
        item.id !== addedItem.id &&
        item.categoryId !== addedItem.categoryId
    );
    if (bestSellers.length > 0) {
      const pick = bestSellers[0];
      suggestions.push({
        itemId: pick.id,
        message: "Guests love this one",
        type: "popular",
      });
    }
  }

  // 3. High-margin chef recommendation
  if (suggestions.length < 3) {
    const highMargin = allItems.filter(
      (item) =>
        item.highMargin &&
        !inCart.has(item.id) &&
        item.id !== addedItem.id &&
        !suggestions.some((s) => s.itemId === item.id)
    );
    if (highMargin.length > 0) {
      suggestions.push({
        itemId: highMargin[0].id,
        message: "Chef's recommendation",
        type: "chef",
      });
    }
  }

  return suggestions.slice(0, 3);
}

// Idle suggestion — shown when user hasn't interacted for 20s
export function getIdleSuggestion(
  allItems: MenuItem[],
  cartItemIds: string[]
): UpsellSuggestion | null {
  const inCart = new Set(cartItemIds);
  const candidates = allItems.filter(
    (item) => (item.highMargin || item.bestSeller) && !inCart.has(item.id)
  );

  if (candidates.length === 0) return null;

  const pick = candidates[Math.floor(Math.random() * candidates.length)];
  return {
    itemId: pick.id,
    message: "Chef's special — don't miss this",
    type: "idle",
  };
}
