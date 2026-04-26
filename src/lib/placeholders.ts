// Image resolver for menu items
// Maps item image paths to real food photography (Unsplash)
// In production, restaurants upload their own photos

export function foodPlaceholder(
  emoji: string,
  bgFrom: string,
  bgTo: string
): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600" viewBox="0 0 800 600">
    <defs>
      <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" style="stop-color:${bgFrom}"/>
        <stop offset="100%" style="stop-color:${bgTo}"/>
      </linearGradient>
    </defs>
    <rect width="800" height="600" fill="url(#bg)"/>
    <text x="400" y="320" font-size="120" text-anchor="middle" dominant-baseline="central">${emoji}</text>
  </svg>`;

  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

// Real food photos from Unsplash — optimized sizes for menu cards
export const FOOD_PHOTOS: Record<string, string> = {
  "/images/hummus.jpg": "https://images.unsplash.com/photo-1577805947697-89e18249d767?w=600&h=450&fit=crop&q=80",
  "/images/halloumi.jpg": "https://images.unsplash.com/photo-1497534446932-c925b458314e?w=600&h=450&fit=crop&q=80",
  "/images/calamari.jpg": "https://images.unsplash.com/photo-1599487488170-d11ec9c172f0?w=600&h=450&fit=crop&q=80",
  "/images/seabass.jpg": "https://images.unsplash.com/photo-1534604973900-c43ab4c2e0ab?w=600&h=450&fit=crop&q=80",
  "/images/kofta.jpg": "https://images.unsplash.com/photo-1529006557810-274b9b2fc783?w=600&h=450&fit=crop&q=80",
  "/images/shrimp-pasta.jpg": "https://images.unsplash.com/photo-1563379926898-05f4575a45d8?w=600&h=450&fit=crop&q=80",
  "/images/burger.jpg": "https://images.unsplash.com/photo-1568901346375-23c9450c58cd?w=600&h=450&fit=crop&q=80",
  "/images/white-wine.jpg": "https://images.unsplash.com/photo-1474722883778-792e7990302f?w=600&h=450&fit=crop&q=80",
  "/images/beer.jpg": "https://images.unsplash.com/photo-1535958636474-b021ee887b13?w=600&h=450&fit=crop&q=80",
  "/images/cocktail.jpg": "https://images.unsplash.com/photo-1514362545857-3bc16c4c7d1b?w=600&h=450&fit=crop&q=80",
  "/images/lemonade.jpg": "https://images.unsplash.com/photo-1523677011781-c91d1bbe2f9e?w=600&h=450&fit=crop&q=80",
  "/images/espresso.jpg": "https://images.unsplash.com/photo-1510707577719-ae7c14805e3a?w=600&h=450&fit=crop&q=80",
  "/images/kunafa.jpg": "https://images.unsplash.com/photo-1567171466295-4afa63d45416?w=600&h=450&fit=crop&q=80",
  "/images/lava-cake.jpg": "https://images.unsplash.com/photo-1624353365286-3f8d62daad51?w=600&h=450&fit=crop&q=80",
};

// Fallback SVG placeholders (used only if Unsplash is unreachable)
export const FOOD_PLACEHOLDERS: Record<string, string> = {
  "/images/hummus.jpg": foodPlaceholder("🫘", "#f5ead6", "#e8d5b3"),
  "/images/halloumi.jpg": foodPlaceholder("🧀", "#fdf8f0", "#f5ead6"),
  "/images/calamari.jpg": foodPlaceholder("🦑", "#dff1ff", "#b8e2ff"),
  "/images/seabass.jpg": foodPlaceholder("🐟", "#b8e2ff", "#7ccbff"),
  "/images/kofta.jpg": foodPlaceholder("🍢", "#ffe8e0", "#ffc9b8"),
  "/images/shrimp-pasta.jpg": foodPlaceholder("🍝", "#ffe8e0", "#ffa085"),
  "/images/burger.jpg": foodPlaceholder("🍔", "#f5ead6", "#d4b896"),
  "/images/white-wine.jpg": foodPlaceholder("🍷", "#fdf8f0", "#dff1ff"),
  "/images/beer.jpg": foodPlaceholder("🍺", "#fdf8f0", "#f5ead6"),
  "/images/cocktail.jpg": foodPlaceholder("🍹", "#ffe8e0", "#ffc9b8"),
  "/images/lemonade.jpg": foodPlaceholder("🍋", "#fdf8f0", "#f5ead6"),
  "/images/espresso.jpg": foodPlaceholder("☕", "#e8d5b3", "#c19b6e"),
  "/images/kunafa.jpg": foodPlaceholder("🍮", "#ffe8e0", "#ffc9b8"),
  "/images/lava-cake.jpg": foodPlaceholder("🍫", "#d4b896", "#7d6142"),
};

export function resolveImage(path: string | null | undefined): string {
  if (!path) return foodPlaceholder("🍽️", "#f5ead6", "#e8d5b3");
  // If it's already a full URL (uploaded photo or Unsplash), use directly
  if (path.startsWith("http")) return path;
  // Map known paths to real photos
  return FOOD_PHOTOS[path] || FOOD_PLACEHOLDERS[path] || path;
}
