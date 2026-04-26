import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const db = new PrismaClient({ adapter });

const u = (id: string, w = 600, h = 450) =>
  `https://images.unsplash.com/photo-${id}?w=${w}&h=${h}&fit=crop&q=80`;

type Cat = {
  name: string; nameAr: string; slug: string; sortOrder: number;
  icon: string; station: "KITCHEN" | "BAR";
};

type Item = {
  name: string; nameAr?: string; description?: string; price: number;
  image: string; categorySlug: string; sortOrder: number;
  prepTime?: number; bestSeller?: boolean;
  addOns?: { name: string; price: number }[];
};

const categories: Cat[] = [
  { name: "Breakfast Platters", nameAr: "فطور", slug: "breakfast", sortOrder: 1, icon: "🥐", station: "KITCHEN" },
  { name: "Egg Dishes", nameAr: "أطباق البيض", slug: "eggs", sortOrder: 2, icon: "🍳", station: "KITCHEN" },
  { name: "Chef's Special", nameAr: "سبيشال الشيف", slug: "chefs-special", sortOrder: 3, icon: "🍞", station: "KITCHEN" },
  { name: "Fresh Juices", nameAr: "عصائر طازجة", slug: "fresh-juices", sortOrder: 4, icon: "🧃", station: "BAR" },
  { name: "Soft Drinks", nameAr: "مشروبات غازية", slug: "soft-drinks", sortOrder: 5, icon: "🥤", station: "BAR" },
  { name: "Ice Cream", nameAr: "آيس كريم", slug: "ice-cream", sortOrder: 6, icon: "🍦", station: "BAR" },
  { name: "Milkshakes", nameAr: "ميلك شيك", slug: "milkshakes", sortOrder: 7, icon: "🥤", station: "BAR" },
  { name: "Desserts", nameAr: "حلويات", slug: "desserts", sortOrder: 8, icon: "🧇", station: "KITCHEN" },
  { name: "Cocktails", nameAr: "كوكتيلات", slug: "cocktails", sortOrder: 9, icon: "🍹", station: "BAR" },
  { name: "Energy Drinks", nameAr: "مشروبات طاقة", slug: "energy-drinks", sortOrder: 10, icon: "⚡", station: "BAR" },
  { name: "Smoothies", nameAr: "سموذي", slug: "smoothies", sortOrder: 11, icon: "🥤", station: "BAR" },
  { name: "Coffee", nameAr: "قهوة", slug: "coffee", sortOrder: 12, icon: "☕", station: "BAR" },
  { name: "Iced Coffee", nameAr: "قهوة مثلجة", slug: "iced-coffee", sortOrder: 13, icon: "🧊", station: "BAR" },
  { name: "Iced Drinks & Teas", nameAr: "مشروبات مثلجة وشاي", slug: "iced-drinks", sortOrder: 14, icon: "🧋", station: "BAR" },
  { name: "Tea & Herbs", nameAr: "شاي وأعشاب", slug: "tea-herbs", sortOrder: 15, icon: "🌿", station: "BAR" },
  { name: "Sahlab", nameAr: "سحلب", slug: "sahlab", sortOrder: 16, icon: "🥛", station: "BAR" },
  { name: "Extras", nameAr: "إضافات", slug: "extras", sortOrder: 17, icon: "➕", station: "BAR" },
];

const items: Item[] = [
  // ─── Breakfast Platters ───────────────────────────
  { name: "English Breakfast", nameAr: "فطور إنجليزي", description: "Sausage, mushrooms, bacon, potato, toast, butter, choice of eggs", price: 270, image: u("1525351484163-7529414344d8"), categorySlug: "breakfast", sortOrder: 1, prepTime: 15, bestSeller: true },
  { name: "French Toast", nameAr: "فرنش توست", description: "2 sausages, bacon, turkey, mushrooms, potatoes, jam, butter, 2 toast", price: 300, image: u("1484723091739-30a097e8f929"), categorySlug: "breakfast", sortOrder: 2, prepTime: 15 },
  { name: "Neom Breakfast", nameAr: "فطور نيوم", description: "2 slices of toast, mushrooms, sausage, fruit, choice of eggs", price: 220, image: u("1533089860892-a7c6f0a88666"), categorySlug: "breakfast", sortOrder: 3, prepTime: 12, bestSeller: true },
  { name: "Healthy Breakfast", nameAr: "فطور صحي", description: "Muesli, milk, yogurt, cream, fruit, honey, toast", price: 220, image: u("1490474418585-ba9bad8fd0ea"), categorySlug: "breakfast", sortOrder: 4, prepTime: 8 },
  { name: "Turkish Breakfast", nameAr: "فطور تركي", description: "Turkey, cheddar cheese, salami, jam, butter, toast", price: 240, image: u("1558961363-fa8fdf82db35"), categorySlug: "breakfast", sortOrder: 5, prepTime: 10 },
  { name: "Oriental Breakfast", nameAr: "فطور شرقي", description: "Beans, falafel, tomato, cheese, potato, boiled eggs, salad", price: 190, image: u("1529563021893-cc83c992d75d"), categorySlug: "breakfast", sortOrder: 6, prepTime: 12 },
  { name: "Croissant with Filling", nameAr: "كرواسون بالحشو", description: "Butter, jam, cheese, turkey, or chocolate", price: 100, image: u("1555507036-ab1f4038024a"), categorySlug: "breakfast", sortOrder: 7, prepTime: 5 },
  { name: "(Just in Neom) Croissant", nameAr: "كرواسون نيوم", description: "Neom special croissant", price: 130, image: u("1530610476181-d83430b64dcd"), categorySlug: "breakfast", sortOrder: 8, prepTime: 5 },

  // ─── Egg Dishes ───────────────────────────────────
  { name: "Bacon & Eggs", nameAr: "بيض وبيكون", price: 150, image: u("1528735602780-2552fd46c7af"), categorySlug: "eggs", sortOrder: 1, prepTime: 8 },
  { name: "Baclou Egg Omelet", nameAr: "أومليت باكلو", price: 200, image: u("1510693206972-df098062cb71"), categorySlug: "eggs", sortOrder: 2, prepTime: 10 },
  { name: "Cheese Omelet", nameAr: "أومليت جبنة", price: 140, image: u("1612240498936-65f5101365d2"), categorySlug: "eggs", sortOrder: 3, prepTime: 8 },
  { name: "Spanish Omelet", nameAr: "أومليت إسباني", price: 140, image: u("1565299507177-b0ac66763828"), categorySlug: "eggs", sortOrder: 4, prepTime: 10 },
  { name: "Three Eggs of Your Choice", nameAr: "٣ بيضات باختيارك", description: "Scrambled, sunny side, or omelet", price: 120, image: u("1482049016688-2d3e1b311543"), categorySlug: "eggs", sortOrder: 5, prepTime: 6 },

  // ─── Chef's Special ───────────────────────────────
  { name: "Avocado & Creamy Cheese Toast", nameAr: "توست أفوكادو وجبنة كريمي", price: 200, image: u("1541519227354-08fa5d50c44d"), categorySlug: "chefs-special", sortOrder: 1, prepTime: 8, bestSeller: true },
  { name: "Cheesy Toast", nameAr: "توست بالجبنة", price: 150, image: u("1528736235302-52922df5c122"), categorySlug: "chefs-special", sortOrder: 2, prepTime: 6 },
  { name: "Croque Madame", nameAr: "كروك مدام", price: 250, image: u("1484723091739-30a097e8f929"), categorySlug: "chefs-special", sortOrder: 3, prepTime: 12 },
  { name: "Egg in a Hole", nameAr: "بيضة في الخبز", price: 140, image: u("1525351484163-7529414344d8"), categorySlug: "chefs-special", sortOrder: 4, prepTime: 8 },

  // ─── Fresh Juices ─────────────────────────────────
  { name: "Mango Juice", nameAr: "عصير مانجو", price: 130, image: u("1546173159-315724a31696"), categorySlug: "fresh-juices", sortOrder: 1, prepTime: 3, bestSeller: true },
  { name: "Strawberry Juice", nameAr: "عصير فراولة", price: 130, image: u("1499638673689-79a0b92e1bce"), categorySlug: "fresh-juices", sortOrder: 2, prepTime: 3 },
  { name: "Strawberry with Milk", nameAr: "فراولة بالحليب", price: 140, image: u("1497534446932-c925b458314e"), categorySlug: "fresh-juices", sortOrder: 3, prepTime: 3 },
  { name: "Guava Juice", nameAr: "عصير جوافة", price: 130, image: u("1600271886007-c1c940f1f498"), categorySlug: "fresh-juices", sortOrder: 4, prepTime: 3 },
  { name: "Guava with Mint", nameAr: "جوافة بالنعناع", price: 140, image: u("1600271886007-c1c940f1f498"), categorySlug: "fresh-juices", sortOrder: 5, prepTime: 3 },
  { name: "Guava with Milk", nameAr: "جوافة بالحليب", price: 140, image: u("1600271886007-c1c940f1f498"), categorySlug: "fresh-juices", sortOrder: 6, prepTime: 3 },
  { name: "Lemon Juice", nameAr: "عصير ليمون", price: 110, image: u("1523677011781-c91d1bbe2f9e"), categorySlug: "fresh-juices", sortOrder: 7, prepTime: 3 },
  { name: "Lemon with Mint", nameAr: "ليمون بالنعناع", price: 130, image: u("1556679343-c7306c1976bc"), categorySlug: "fresh-juices", sortOrder: 8, prepTime: 3 },
  { name: "Watermelon Juice", nameAr: "عصير بطيخ", price: 130, image: u("1527161153332-f99fded0e024"), categorySlug: "fresh-juices", sortOrder: 9, prepTime: 3 },
  { name: "Watermelon with Mint", nameAr: "بطيخ بالنعناع", price: 140, image: u("1527161153332-f99fded0e024"), categorySlug: "fresh-juices", sortOrder: 10, prepTime: 3 },
  { name: "Avocado Juice", nameAr: "عصير أفوكادو", price: 150, image: u("1638176066666-694728804773"), categorySlug: "fresh-juices", sortOrder: 11, prepTime: 3 },
  { name: "Orange Juice", nameAr: "عصير برتقال", price: 130, image: u("1621506289937-a8e93c95b77f"), categorySlug: "fresh-juices", sortOrder: 12, prepTime: 3, bestSeller: true },
  { name: "Banana with Milk", nameAr: "موز بالحليب", price: 140, image: u("1571019613454-1cb2f99b2d8b"), categorySlug: "fresh-juices", sortOrder: 13, prepTime: 3 },
  { name: "Banana with Caramel", nameAr: "موز بالكراميل", price: 150, image: u("1571019613454-1cb2f99b2d8b"), categorySlug: "fresh-juices", sortOrder: 14, prepTime: 3 },
  { name: "Kiwi Juice", nameAr: "عصير كيوي", price: 150, image: u("1616684000067-36952fde56ec"), categorySlug: "fresh-juices", sortOrder: 15, prepTime: 3 },

  // ─── Soft Drinks ──────────────────────────────────
  { name: "Cola / Sprite / Fayrouz", nameAr: "كولا / سبرايت / فيروز", price: 70, image: u("1581636625402-29b2a704ef13"), categorySlug: "soft-drinks", sortOrder: 1, prepTime: 1 },
  { name: "Soda", nameAr: "صودا", price: 80, image: u("1581636625402-29b2a704ef13"), categorySlug: "soft-drinks", sortOrder: 2, prepTime: 1 },
  { name: "Red Bull", nameAr: "ريد بول", price: 130, image: u("1527960471264-932f39eb5846"), categorySlug: "soft-drinks", sortOrder: 3, prepTime: 1 },
  { name: "Flavors (Berry, Lemon, Mint…)", nameAr: "نكهات (توت، ليمون، نعناع...)", price: 150, image: u("1558642452-9d2a7deb7f62"), categorySlug: "soft-drinks", sortOrder: 4, prepTime: 2 },
  { name: "Sparkling Water", nameAr: "مياه فوارة", price: 80, image: u("1559839914-17aae7fec722"), categorySlug: "soft-drinks", sortOrder: 5, prepTime: 1 },
  { name: "Small Water", nameAr: "مياه صغيرة", price: 30, image: u("1548839140-29a749e1cf4d"), categorySlug: "soft-drinks", sortOrder: 6, prepTime: 1 },
  { name: "Big Water", nameAr: "مياه كبيرة", price: 40, image: u("1548839140-29a749e1cf4d"), categorySlug: "soft-drinks", sortOrder: 7, prepTime: 1 },
  { name: "Flo Water", nameAr: "مياه فلو", price: 50, image: u("1548839140-29a749e1cf4d"), categorySlug: "soft-drinks", sortOrder: 8, prepTime: 1 },

  // ─── Ice Cream ────────────────────────────────────
  { name: "Double Scoop", nameAr: "سكوبين", description: "Vanilla, Chocolate, Strawberry, Mango", price: 80, image: u("1497034825429-c343d7c6a68f"), categorySlug: "ice-cream", sortOrder: 1, prepTime: 2 },
  { name: "Triple Scoop", nameAr: "٣ سكوبات", description: "Vanilla, Chocolate, Strawberry, Mango", price: 120, image: u("1563805042-7684c019e1cb"), categorySlug: "ice-cream", sortOrder: 2, prepTime: 2 },

  // ─── Milkshakes ───────────────────────────────────
  { name: "Vanilla Milkshake", nameAr: "ميلك شيك فانيلا", price: 140, image: u("1572490122747-3968b75cc699"), categorySlug: "milkshakes", sortOrder: 1, prepTime: 4 },
  { name: "Chocolate Milkshake", nameAr: "ميلك شيك شوكولاتة", price: 150, image: u("1541658016709-82535e94bc69"), categorySlug: "milkshakes", sortOrder: 2, prepTime: 4, bestSeller: true },
  { name: "Nutella Milkshake", nameAr: "ميلك شيك نوتيلا", price: 180, image: u("1577805947697-89e18249d767"), categorySlug: "milkshakes", sortOrder: 3, prepTime: 4 },
  { name: "Strawberry Milkshake", nameAr: "ميلك شيك فراولة", price: 140, image: u("1568901839119-631418a3910d"), categorySlug: "milkshakes", sortOrder: 4, prepTime: 4 },
  { name: "Mango Milkshake", nameAr: "ميلك شيك مانجو", price: 150, image: u("1546173159-315724a31696"), categorySlug: "milkshakes", sortOrder: 5, prepTime: 4 },
  { name: "Blueberry Milkshake", nameAr: "ميلك شيك بلوبيري", price: 150, image: u("1553530666-ba11a7da3888"), categorySlug: "milkshakes", sortOrder: 6, prepTime: 4 },
  { name: "Mix Berry Milkshake", nameAr: "ميلك شيك ميكس بيري", price: 150, image: u("1553530666-ba11a7da3888"), categorySlug: "milkshakes", sortOrder: 7, prepTime: 4 },
  { name: "Banana Milkshake", nameAr: "ميلك شيك موز", price: 140, image: u("1571019613454-1cb2f99b2d8b"), categorySlug: "milkshakes", sortOrder: 8, prepTime: 4 },
  { name: "Oreo Milkshake", nameAr: "ميلك شيك أوريو", price: 150, image: u("1563805042-7684c019e1cb"), categorySlug: "milkshakes", sortOrder: 9, prepTime: 4, bestSeller: true },
  { name: "Caramel Milkshake", nameAr: "ميلك شيك كراميل", price: 140, image: u("1572490122747-3968b75cc699"), categorySlug: "milkshakes", sortOrder: 10, prepTime: 4 },
  { name: "Lotus Milkshake", nameAr: "ميلك شيك لوتس", price: 140, image: u("1572490122747-3968b75cc699"), categorySlug: "milkshakes", sortOrder: 11, prepTime: 4 },
  { name: "Nutella Milkshake (Special)", nameAr: "ميلك شيك نوتيلا سبيشال", price: 160, image: u("1577805947697-89e18249d767"), categorySlug: "milkshakes", sortOrder: 12, prepTime: 4 },
  { name: "Kiwi Milkshake", nameAr: "ميلك شيك كيوي", price: 160, image: u("1616684000067-36952fde56ec"), categorySlug: "milkshakes", sortOrder: 13, prepTime: 4 },

  // ─── Desserts ─────────────────────────────────────
  { name: "Classic Pancakes", nameAr: "بانكيك كلاسيك", price: 150, image: u("1567620905862-fe2e4a2e11dc"), categorySlug: "desserts", sortOrder: 1, prepTime: 10 },
  { name: "Nutella Pancakes", nameAr: "بانكيك نوتيلا", price: 200, image: u("1565299543923-37dd37887442"), categorySlug: "desserts", sortOrder: 2, prepTime: 10, bestSeller: true },
  { name: "Chocolate Pancakes", nameAr: "بانكيك شوكولاتة", price: 170, image: u("1565299543923-37dd37887442"), categorySlug: "desserts", sortOrder: 3, prepTime: 10 },
  { name: "Strawberry Pancakes", nameAr: "بانكيك فراولة", price: 170, image: u("1567620905862-fe2e4a2e11dc"), categorySlug: "desserts", sortOrder: 4, prepTime: 10 },
  { name: "Blueberry Pancakes", nameAr: "بانكيك بلوبيري", price: 180, image: u("1528207776546-365bb710ee93"), categorySlug: "desserts", sortOrder: 5, prepTime: 10 },
  { name: "Lotus Pancakes", nameAr: "بانكيك لوتس", price: 190, image: u("1567620905862-fe2e4a2e11dc"), categorySlug: "desserts", sortOrder: 6, prepTime: 10 },
  { name: "Chocolate Waffle", nameAr: "وافل شوكولاتة", price: 170, image: u("1562376552-0d160a2f238d"), categorySlug: "desserts", sortOrder: 7, prepTime: 8 },
  { name: "Nutella Waffle", nameAr: "وافل نوتيلا", price: 230, image: u("1562376552-0d160a2f238d"), categorySlug: "desserts", sortOrder: 8, prepTime: 8, bestSeller: true },
  { name: "Oreo Waffle", nameAr: "وافل أوريو", price: 180, image: u("1562376552-0d160a2f238d"), categorySlug: "desserts", sortOrder: 9, prepTime: 8 },
  { name: "Lotus Waffle", nameAr: "وافل لوتس", price: 180, image: u("1562376552-0d160a2f238d"), categorySlug: "desserts", sortOrder: 10, prepTime: 8 },
  { name: "Waffle Neom", nameAr: "وافل نيوم", price: 250, image: u("1562376552-0d160a2f238d"), categorySlug: "desserts", sortOrder: 11, prepTime: 10, bestSeller: true },
  { name: "Umm Ali (Plain)", nameAr: "أم علي سادة", price: 130, image: u("1571019613454-1cb2f99b2d8b"), categorySlug: "desserts", sortOrder: 12, prepTime: 12 },
  { name: "Umm Ali with Nuts", nameAr: "أم علي بالمكسرات", price: 180, image: u("1571019613454-1cb2f99b2d8b"), categorySlug: "desserts", sortOrder: 13, prepTime: 12 },
  { name: "Oreo Madness", nameAr: "أوريو مادنس", price: 200, image: u("1563805042-7684c019e1cb"), categorySlug: "desserts", sortOrder: 14, prepTime: 10 },

  // ─── Cocktails ────────────────────────────────────
  { name: "Blue Sky", nameAr: "بلو سكاي", description: "Ice, Blue Curaçao, pineapple, soda or Sprite", price: 180, image: u("1514362545857-3bc16c4c7d1b"), categorySlug: "cocktails", sortOrder: 1, prepTime: 4, bestSeller: true },
  { name: "Florida", nameAr: "فلوريدا", description: "Mango, strawberry, guava", price: 180, image: u("1560508179-b2c9a3f8e92b"), categorySlug: "cocktails", sortOrder: 2, prepTime: 4 },
  { name: "Pina Colada", nameAr: "بينا كولادا", description: "Coconut, milk, ice, pineapple", price: 180, image: u("1587223962217-e1d4f4be3cd7"), categorySlug: "cocktails", sortOrder: 3, prepTime: 4 },
  { name: "Kiwi Mango", nameAr: "كيوي مانجو", price: 180, image: u("1560508179-b2c9a3f8e92b"), categorySlug: "cocktails", sortOrder: 4, prepTime: 4 },
  { name: "Orange Berry", nameAr: "أورانج بيري", description: "Blueberry, orange, ice, mint", price: 170, image: u("1560508179-b2c9a3f8e92b"), categorySlug: "cocktails", sortOrder: 5, prepTime: 4 },
  { name: "Paradise", nameAr: "باراديس", description: "Mango, lemon, mint", price: 170, image: u("1536935338788-846bb9981813"), categorySlug: "cocktails", sortOrder: 6, prepTime: 4 },
  { name: "Neom Special Cocktail", nameAr: "كوكتيل نيوم سبيشال", description: "Guava, mango, strawberry, fruits", price: 200, image: u("1514362545857-3bc16c4c7d1b"), categorySlug: "cocktails", sortOrder: 7, prepTime: 5, bestSeller: true },

  // ─── Energy Drinks ────────────────────────────────
  { name: "Hammer", nameAr: "هامر", description: "Espresso + Red Bull", price: 180, image: u("1527960471264-932f39eb5846"), categorySlug: "energy-drinks", sortOrder: 1, prepTime: 3 },
  { name: "Orange Coffee", nameAr: "قهوة برتقال", description: "Ice, orange, coffee", price: 140, image: u("1461023058943-07fcbe16d735"), categorySlug: "energy-drinks", sortOrder: 2, prepTime: 3 },
  { name: "Blue Latte", nameAr: "بلو لاتيه", description: "Ice, milk, espresso, Blue Curaçao", price: 140, image: u("1461023058943-07fcbe16d735"), categorySlug: "energy-drinks", sortOrder: 3, prepTime: 3 },

  // ─── Smoothies ────────────────────────────────────
  { name: "Mango Smoothie", nameAr: "سموذي مانجو", price: 140, image: u("1546173159-315724a31696"), categorySlug: "smoothies", sortOrder: 1, prepTime: 4, bestSeller: true },
  { name: "Strawberry Smoothie", nameAr: "سموذي فراولة", price: 140, image: u("1499638673689-79a0b92e1bce"), categorySlug: "smoothies", sortOrder: 2, prepTime: 4 },
  { name: "Guava Smoothie", nameAr: "سموذي جوافة", price: 140, image: u("1600271886007-c1c940f1f498"), categorySlug: "smoothies", sortOrder: 3, prepTime: 4 },
  { name: "Lemon Smoothie", nameAr: "سموذي ليمون", price: 130, image: u("1523677011781-c91d1bbe2f9e"), categorySlug: "smoothies", sortOrder: 4, prepTime: 4 },
  { name: "Lemon Mint Smoothie", nameAr: "سموذي ليمون بالنعناع", price: 130, image: u("1556679343-c7306c1976bc"), categorySlug: "smoothies", sortOrder: 5, prepTime: 4 },
  { name: "Watermelon Smoothie", nameAr: "سموذي بطيخ", price: 130, image: u("1527161153332-f99fded0e024"), categorySlug: "smoothies", sortOrder: 6, prepTime: 4 },
  { name: "Orange Smoothie", nameAr: "سموذي برتقال", price: 130, image: u("1621506289937-a8e93c95b77f"), categorySlug: "smoothies", sortOrder: 7, prepTime: 4 },
  { name: "Blueberry Smoothie", nameAr: "سموذي بلوبيري", price: 130, image: u("1553530666-ba11a7da3888"), categorySlug: "smoothies", sortOrder: 8, prepTime: 4 },
  { name: "Kiwi Smoothie", nameAr: "سموذي كيوي", price: 150, image: u("1616684000067-36952fde56ec"), categorySlug: "smoothies", sortOrder: 9, prepTime: 4 },

  // ─── Coffee ───────────────────────────────────────
  { name: "Espresso (Single)", nameAr: "إسبريسو سنجل", price: 100, image: u("1510707577719-ae7c14805e3a"), categorySlug: "coffee", sortOrder: 1, prepTime: 2 },
  { name: "Espresso (Double)", nameAr: "إسبريسو دبل", price: 110, image: u("1510707577719-ae7c14805e3a"), categorySlug: "coffee", sortOrder: 2, prepTime: 2 },
  { name: "Cappuccino", nameAr: "كابتشينو", price: 120, image: u("1572442388796-11668a67e53d"), categorySlug: "coffee", sortOrder: 3, prepTime: 3, bestSeller: true },
  { name: "Cappuccino Flavors", nameAr: "كابتشينو بالنكهات", description: "Caramel, Vanilla, Coconut, Hazelnut, Chocolate", price: 130, image: u("1572442388796-11668a67e53d"), categorySlug: "coffee", sortOrder: 4, prepTime: 3 },
  { name: "Americano", nameAr: "أمريكانو", price: 100, image: u("1521302080334-4bebac2763a6"), categorySlug: "coffee", sortOrder: 5, prepTime: 2 },
  { name: "Latte", nameAr: "لاتيه", price: 120, image: u("1461023058943-07fcbe16d735"), categorySlug: "coffee", sortOrder: 6, prepTime: 3, bestSeller: true },
  { name: "Spanish Latte", nameAr: "سبانيش لاتيه", price: 150, image: u("1461023058943-07fcbe16d735"), categorySlug: "coffee", sortOrder: 7, prepTime: 3, bestSeller: true },
  { name: "Mocha", nameAr: "موكا", price: 120, image: u("1578314675249-a6910f80cc4e"), categorySlug: "coffee", sortOrder: 8, prepTime: 3 },
  { name: "Nescafe Black", nameAr: "نسكافيه سادة", price: 80, image: u("1495774856032-8b90bbb32b32"), categorySlug: "coffee", sortOrder: 9, prepTime: 2 },
  { name: "Nescafe with Milk", nameAr: "نسكافيه بالحليب", price: 100, image: u("1495774856032-8b90bbb32b32"), categorySlug: "coffee", sortOrder: 10, prepTime: 2 },
  { name: "Flat White", nameAr: "فلات وايت", price: 120, image: u("1572442388796-11668a67e53d"), categorySlug: "coffee", sortOrder: 11, prepTime: 3 },
  { name: "Macchiato", nameAr: "ماكياتو", price: 120, image: u("1510707577719-ae7c14805e3a"), categorySlug: "coffee", sortOrder: 12, prepTime: 2 },
  { name: "Cortado", nameAr: "كورتادو", price: 120, image: u("1510707577719-ae7c14805e3a"), categorySlug: "coffee", sortOrder: 13, prepTime: 2 },
  { name: "Piccolo", nameAr: "بيكولو", price: 100, image: u("1510707577719-ae7c14805e3a"), categorySlug: "coffee", sortOrder: 14, prepTime: 2 },
  { name: "Turkish Coffee (Plain)", nameAr: "قهوة تركي سادة", price: 80, image: u("1514432324607-273d43e5e500"), categorySlug: "coffee", sortOrder: 15, prepTime: 4 },
  { name: "Turkish Coffee (Special)", nameAr: "قهوة تركي سبيشال", price: 100, image: u("1514432324607-273d43e5e500"), categorySlug: "coffee", sortOrder: 16, prepTime: 4 },
  { name: "French Coffee", nameAr: "قهوة فرنسي", price: 120, image: u("1495774856032-8b90bbb32b32"), categorySlug: "coffee", sortOrder: 17, prepTime: 3 },
  { name: "Hazelnut Coffee", nameAr: "قهوة بالبندق", price: 130, image: u("1461023058943-07fcbe16d735"), categorySlug: "coffee", sortOrder: 18, prepTime: 3 },
  { name: "Raf Coffee", nameAr: "راف كوفي", price: 120, image: u("1461023058943-07fcbe16d735"), categorySlug: "coffee", sortOrder: 19, prepTime: 3 },
  { name: "Hot Chocolate", nameAr: "هوت شوكولت", price: 130, image: u("1578314675249-a6910f80cc4e"), categorySlug: "coffee", sortOrder: 20, prepTime: 3 },

  // ─── Iced Coffee ──────────────────────────────────
  { name: "Iced Americano", nameAr: "آيس أمريكانو", price: 110, image: u("1517701604599-bb29b565090c"), categorySlug: "iced-coffee", sortOrder: 1, prepTime: 2, bestSeller: true },
  { name: "Iced Cappuccino", nameAr: "آيس كابتشينو", price: 140, image: u("1517701604599-bb29b565090c"), categorySlug: "iced-coffee", sortOrder: 2, prepTime: 3 },
  { name: "Iced Latte", nameAr: "آيس لاتيه", price: 140, image: u("1517701604599-bb29b565090c"), categorySlug: "iced-coffee", sortOrder: 3, prepTime: 3, bestSeller: true },
  { name: "Iced Mocha", nameAr: "آيس موكا", price: 140, image: u("1578314675249-a6910f80cc4e"), categorySlug: "iced-coffee", sortOrder: 4, prepTime: 3 },
  { name: "Iced Spanish Latte", nameAr: "آيس سبانيش لاتيه", price: 150, image: u("1517701604599-bb29b565090c"), categorySlug: "iced-coffee", sortOrder: 5, prepTime: 3 },
  { name: "Iced Frappuccino", nameAr: "آيس فرابتشينو", price: 140, image: u("1461023058943-07fcbe16d735"), categorySlug: "iced-coffee", sortOrder: 6, prepTime: 4 },
  { name: "Iced Caramel Frappe", nameAr: "آيس كراميل فرابيه", price: 150, image: u("1461023058943-07fcbe16d735"), categorySlug: "iced-coffee", sortOrder: 7, prepTime: 4 },
  { name: "Iced Vanilla Frappe", nameAr: "آيس فانيلا فرابيه", price: 150, image: u("1461023058943-07fcbe16d735"), categorySlug: "iced-coffee", sortOrder: 8, prepTime: 4 },

  // ─── Iced Drinks & Teas ───────────────────────────
  { name: "Mojito", nameAr: "موهيتو", description: "Ice, Sprite, lemon, mint", price: 150, image: u("1551538827-9c037cb4f32a"), categorySlug: "iced-drinks", sortOrder: 1, prepTime: 4, bestSeller: true },
  { name: "Mojito (Special Mix)", nameAr: "موهيتو سبيشال", description: "Mixed fruits", price: 170, image: u("1551538827-9c037cb4f32a"), categorySlug: "iced-drinks", sortOrder: 2, prepTime: 4 },
  { name: "Cherry Cola", nameAr: "تشيري كولا", price: 130, image: u("1581636625402-29b2a704ef13"), categorySlug: "iced-drinks", sortOrder: 3, prepTime: 2 },
  { name: "Red Bull Berry", nameAr: "ريد بول بيري", price: 150, image: u("1527960471264-932f39eb5846"), categorySlug: "iced-drinks", sortOrder: 4, prepTime: 2 },
  { name: "Sunrise", nameAr: "صن رايز", description: "Ice, orange, pomegranate, soda", price: 140, image: u("1536935338788-846bb9981813"), categorySlug: "iced-drinks", sortOrder: 5, prepTime: 3 },
  { name: "Electric Soda", nameAr: "إلكتريك صودا", description: "Blue Curaçao, lemon, mint, soda", price: 130, image: u("1514362545857-3bc16c4c7d1b"), categorySlug: "iced-drinks", sortOrder: 6, prepTime: 3 },
  { name: "Iced Tea", nameAr: "آيس تي", price: 120, image: u("1556679343-c7306c1976bc"), categorySlug: "iced-drinks", sortOrder: 7, prepTime: 3 },
  { name: "Ice Green Tea", nameAr: "آيس جرين تي", price: 120, image: u("1556679343-c7306c1976bc"), categorySlug: "iced-drinks", sortOrder: 8, prepTime: 3 },
  { name: "Iced Hibiscus", nameAr: "كركديه مثلج", price: 120, image: u("1544145945-f90425340c7e"), categorySlug: "iced-drinks", sortOrder: 9, prepTime: 3 },

  // ─── Tea & Herbs ──────────────────────────────────
  { name: "Bedouin Tea", nameAr: "شاي بدوي", price: 100, image: u("1571934811356-4cc1adbd8eba"), categorySlug: "tea-herbs", sortOrder: 1, prepTime: 4 },
  { name: "Black Tea", nameAr: "شاي أسود", price: 80, image: u("1571934811356-4cc1adbd8eba"), categorySlug: "tea-herbs", sortOrder: 2, prepTime: 3 },
  { name: "Green Tea", nameAr: "شاي أخضر", price: 80, image: u("1556679343-c7306c1976bc"), categorySlug: "tea-herbs", sortOrder: 3, prepTime: 3 },
  { name: "Tea with Milk", nameAr: "شاي بالحليب", price: 100, image: u("1571934811356-4cc1adbd8eba"), categorySlug: "tea-herbs", sortOrder: 4, prepTime: 3 },
  { name: "Tea with Mint", nameAr: "شاي بالنعناع", price: 80, image: u("1556679343-c7306c1976bc"), categorySlug: "tea-herbs", sortOrder: 5, prepTime: 3 },
  { name: "Tea Flavors", nameAr: "شاي بالنكهات", price: 100, image: u("1571934811356-4cc1adbd8eba"), categorySlug: "tea-herbs", sortOrder: 6, prepTime: 3 },
  { name: "Anise", nameAr: "ينسون", price: 80, image: u("1544145945-f90425340c7e"), categorySlug: "tea-herbs", sortOrder: 7, prepTime: 3 },
  { name: "Mint", nameAr: "نعناع", price: 80, image: u("1556679343-c7306c1976bc"), categorySlug: "tea-herbs", sortOrder: 8, prepTime: 3 },
  { name: "Hot Ginger Tea", nameAr: "شاي زنجبيل", price: 100, image: u("1544145945-f90425340c7e"), categorySlug: "tea-herbs", sortOrder: 9, prepTime: 4 },
  { name: "Hibiscus", nameAr: "كركديه", price: 100, image: u("1544145945-f90425340c7e"), categorySlug: "tea-herbs", sortOrder: 10, prepTime: 4 },
  { name: "Lemon Honey", nameAr: "ليمون بالعسل", price: 100, image: u("1523677011781-c91d1bbe2f9e"), categorySlug: "tea-herbs", sortOrder: 11, prepTime: 3 },
  { name: "Mix Herbs", nameAr: "أعشاب مشكلة", price: 130, image: u("1544145945-f90425340c7e"), categorySlug: "tea-herbs", sortOrder: 12, prepTime: 4 },
  { name: "Apple Cider", nameAr: "عصير تفاح", price: 100, image: u("1544145945-f90425340c7e"), categorySlug: "tea-herbs", sortOrder: 13, prepTime: 4 },

  // ─── Sahlab ───────────────────────────────────────
  { name: "Sahlab (Plain)", nameAr: "سحلب سادة", price: 130, image: u("1578314675249-a6910f80cc4e"), categorySlug: "sahlab", sortOrder: 1, prepTime: 5 },
  { name: "Sahlab with Nuts", nameAr: "سحلب بالمكسرات", price: 150, image: u("1578314675249-a6910f80cc4e"), categorySlug: "sahlab", sortOrder: 2, prepTime: 5 },
  { name: "Sahlab Chocolate", nameAr: "سحلب شوكولاتة", price: 150, image: u("1578314675249-a6910f80cc4e"), categorySlug: "sahlab", sortOrder: 3, prepTime: 5 },
  { name: "Sahlab Caramel", nameAr: "سحلب كراميل", price: 150, image: u("1578314675249-a6910f80cc4e"), categorySlug: "sahlab", sortOrder: 4, prepTime: 5 },
  { name: "Hummus El Sham", nameAr: "حمص الشام", price: 150, image: u("1578314675249-a6910f80cc4e"), categorySlug: "sahlab", sortOrder: 5, prepTime: 5 },

  // ─── Extras ───────────────────────────────────────
  { name: "Oat Milk", nameAr: "حليب شوفان", description: "Add to any drink", price: 40, image: u("1550583724-b2692b85b150"), categorySlug: "extras", sortOrder: 1, prepTime: 0 },
  { name: "Almond Milk", nameAr: "حليب لوز", description: "Add to any drink", price: 40, image: u("1550583724-b2692b85b150"), categorySlug: "extras", sortOrder: 2, prepTime: 0 },
  { name: "Coconut Milk", nameAr: "حليب جوز هند", description: "Add to any drink", price: 40, image: u("1550583724-b2692b85b150"), categorySlug: "extras", sortOrder: 3, prepTime: 0 },
];

async function main() {
  console.log("Updating Neom Dahab menu...\n");

  const restaurant = await db.restaurant.findUnique({
    where: { slug: "blue-hole-kitchen" },
  });
  if (!restaurant) throw new Error("Restaurant not found — run the main seed first");

  // ── Retire old menu (can't delete — OrderItems reference them) ──
  console.log("Retiring old menu items...");

  // Collect slugs we'll need for new categories
  const newSlugs = new Set(categories.map((c) => c.slug));

  await db.menuItem.updateMany({
    where: { category: { restaurantId: restaurant.id } },
    data: { available: false },
  });

  const oldCats = await db.category.findMany({
    where: { restaurantId: restaurant.id },
  });
  for (const oc of oldCats) {
    // Only rename if this slug collides with a new one or isn't retired yet
    if (newSlugs.has(oc.slug) || !oc.name.startsWith("[OLD] ")) {
      await db.category.update({
        where: { id: oc.id },
        data: {
          name: oc.name.startsWith("[OLD] ") ? oc.name : `[OLD] ${oc.name}`,
          slug: `retired-${oc.id.slice(0, 8)}`,
          sortOrder: 900 + oc.sortOrder,
        },
      });
    }
  }
  console.log(`Retired ${oldCats.length} old categories.\n`);

  // ── Create / update categories ──
  const catMap: Record<string, string> = {};
  for (const cat of categories) {
    const created = await db.category.upsert({
      where: {
        restaurantId_slug: { restaurantId: restaurant.id, slug: cat.slug },
      },
      update: {
        name: cat.name,
        nameAr: cat.nameAr,
        sortOrder: cat.sortOrder,
        icon: cat.icon,
        station: cat.station,
      },
      create: {
        name: cat.name,
        nameAr: cat.nameAr,
        slug: cat.slug,
        sortOrder: cat.sortOrder,
        icon: cat.icon,
        station: cat.station,
        restaurantId: restaurant.id,
      },
    });
    catMap[cat.slug] = created.id;
    console.log(`  ✓ Category: ${cat.icon} ${cat.name}`);
  }
  console.log(`\n${categories.length} categories created.\n`);

  // ── Create menu items ──
  let count = 0;
  for (const item of items) {
    const { categorySlug, addOns, ...data } = item;
    const categoryId = catMap[categorySlug];
    if (!categoryId) {
      console.error(`  ✗ No category for slug "${categorySlug}" — skipping ${item.name}`);
      continue;
    }

    await db.menuItem.create({
      data: {
        name: data.name,
        nameAr: data.nameAr,
        description: data.description,
        price: data.price,
        image: data.image,
        sortOrder: data.sortOrder,
        prepTime: data.prepTime,
        bestSeller: data.bestSeller ?? false,
        categoryId,
        ...(addOns?.length
          ? { addOns: { create: addOns.map((a) => ({ name: a.name, price: a.price })) } }
          : {}),
      },
    });
    count++;
    console.log(`  ${data.name} — ${data.price} L.E`);
  }

  console.log(`\n${count} menu items created.`);
  console.log("\nMenu update complete!");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
