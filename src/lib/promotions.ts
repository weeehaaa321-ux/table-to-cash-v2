// Smart Promotion Engine — time-based triggers

type TimeContext = {
  hour: number; // 0-23
  occupancy: "low" | "medium" | "high";
};

export type ActivePromo = {
  type: "sunset" | "happy_hour" | "low_traffic" | "high_traffic";
  title: string;
  description: string;
  badge?: string;
  itemFilter?: (item: { highMargin: boolean; price: number; tags: string[] }) => boolean;
};

export function getActivePromotions(ctx: TimeContext): ActivePromo[] {
  const promos: ActivePromo[] = [];

  // Sunset mode (17:00 - 19:30) → push premium drinks
  if (ctx.hour >= 17 && ctx.hour < 20) {
    promos.push({
      type: "sunset",
      title: "Golden Hour",
      description: "Premium cocktails for the perfect sunset",
      badge: "🌅 Sunset Special",
      itemFilter: (item) =>
        item.tags.includes("cocktail") ||
        item.tags.includes("wine") ||
        item.tags.includes("premium-drink"),
    });
  }

  // Happy hour (14:00 - 17:00)
  if (ctx.hour >= 14 && ctx.hour < 17) {
    promos.push({
      type: "happy_hour",
      title: "Happy Hour",
      description: "Selected drinks at special prices",
      badge: "🍹 Happy Hour",
      itemFilter: (item) =>
        item.tags.includes("drink") || item.tags.includes("cocktail"),
    });
  }

  // Low traffic → activate discounts on slower items
  if (ctx.occupancy === "low") {
    promos.push({
      type: "low_traffic",
      title: "Special Offer",
      description: "Exclusive deals just for you",
      badge: "✨ Special",
    });
  }

  // High traffic → prioritize high-margin items
  if (ctx.occupancy === "high") {
    promos.push({
      type: "high_traffic",
      title: "Most Popular",
      description: "What everyone's ordering right now",
      itemFilter: (item) => item.highMargin,
    });
  }

  return promos;
}
