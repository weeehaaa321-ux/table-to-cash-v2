export type MenuItem = {
  id: string;
  name: string;
  nameAr?: string | null;
  nameRu?: string | null;
  description?: string | null;
  descAr?: string | null;
  descRu?: string | null;
  price: number;
  // Time-billed activity rate (EGP/hour). When set, ordering this item
  // starts a timer on the OrderItem and bills prorated by elapsed
  // duration; the static `price` is then a minimum-1-hour fallback
  // shown in the menu UI.
  pricePerHour?: number | null;
  image?: string | null;
  available: boolean;
  bestSeller: boolean;
  highMargin: boolean;
  calories?: number | null;
  prepTime?: number | null;
  sortOrder: number;
  categoryId: string;
  pairsWith: string[];
  tags: string[];
  views: number;
  addOns: AddOn[];
};

export type AddOn = {
  id: string;
  name: string;
  price: number;
};

export type Category = {
  id: string;
  name: string;
  nameAr?: string | null;
  nameRu?: string | null;
  slug: string;
  sortOrder: number;
  icon?: string | null;
  station?: "KITCHEN" | "BAR" | "ACTIVITY";
  items: MenuItem[];
};

export type CartItem = {
  menuItem: MenuItem;
  quantity: number;
  selectedAddOns: AddOn[];
  notes?: string;
  wasUpsell?: boolean;
};

export type OrderData = {
  id: string;
  orderNumber: number;
  status: string;
  items: {
    menuItem: { name: string; image?: string | null };
    quantity: number;
    price: number;
  }[];
  total: number;
  createdAt: string;
  tableNumber: number;
};

export type Language = "en" | "ar" | "ru" | "de" | "it";
