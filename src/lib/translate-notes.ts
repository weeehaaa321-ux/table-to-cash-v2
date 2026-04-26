const DICT: Record<string, string> = {
  // Cooking preferences
  "no salt": "بدون ملح",
  "less salt": "ملح أقل",
  "extra salt": "ملح زيادة",
  "no sugar": "بدون سكر",
  "less sugar": "سكر أقل",
  "extra sugar": "سكر زيادة",
  "no ice": "بدون ثلج",
  "less ice": "ثلج أقل",
  "extra ice": "ثلج زيادة",
  "no spice": "بدون بهارات",
  "no spicy": "بدون حار",
  "less spicy": "أقل حرارة",
  "extra spicy": "حار زيادة",
  "very spicy": "حار جداً",
  "mild": "خفيف",
  "medium": "وسط",
  "spicy": "حار",
  "hot": "حار",
  "well done": "مستوي تماماً",
  "medium well": "مستوي وسط",
  "medium rare": "نص استواء",
  "rare": "نيء تقريباً",
  "crispy": "مقرمش",
  "extra crispy": "مقرمش زيادة",
  "soft": "طري",
  "grilled": "مشوي",
  "fried": "مقلي",
  "steamed": "مطهو بالبخار",
  "boiled": "مسلوق",
  "toasted": "محمّص",
  "fresh": "طازج",
  "warm": "دافئ",
  "cold": "بارد",
  "room temperature": "درجة حرارة الغرفة",
  "on the side": "على جنب",
  "separate": "منفصل",
  "mixed": "مخلوط",

  // Dietary / allergies
  "no onion": "بدون بصل",
  "no onions": "بدون بصل",
  "extra onion": "بصل زيادة",
  "no garlic": "بدون ثوم",
  "extra garlic": "ثوم زيادة",
  "no cheese": "بدون جبنة",
  "extra cheese": "جبنة زيادة",
  "no mayo": "بدون مايونيز",
  "no mayonnaise": "بدون مايونيز",
  "extra mayo": "مايونيز زيادة",
  "no ketchup": "بدون كاتشب",
  "extra ketchup": "كاتشب زيادة",
  "no mustard": "بدون مسطردة",
  "no sauce": "بدون صوص",
  "extra sauce": "صوص زيادة",
  "no butter": "بدون زبدة",
  "extra butter": "زبدة زيادة",
  "no oil": "بدون زيت",
  "no cream": "بدون كريمة",
  "extra cream": "كريمة زيادة",
  "no milk": "بدون حليب",
  "oat milk": "حليب شوفان",
  "almond milk": "حليب لوز",
  "coconut milk": "حليب جوز هند",
  "no nuts": "بدون مكسرات",
  "no tomato": "بدون طماطم",
  "no tomatoes": "بدون طماطم",
  "extra tomato": "طماطم زيادة",
  "no lettuce": "بدون خس",
  "no pickle": "بدون مخلل",
  "no pickles": "بدون مخلل",
  "extra pickle": "مخلل زيادة",
  "no pepper": "بدون فلفل",
  "extra pepper": "فلفل زيادة",
  "no egg": "بدون بيض",
  "extra egg": "بيض زيادة",
  "no bread": "بدون خبز",
  "extra bread": "خبز زيادة",
  "no lemon": "بدون ليمون",
  "extra lemon": "ليمون زيادة",
  "no mint": "بدون نعناع",
  "extra mint": "نعناع زيادة",
  "no parsley": "بدون بقدونس",
  "no cilantro": "بدون كزبرة",
  "no gluten": "بدون جلوتين",
  "gluten free": "خالي من الجلوتين",
  "dairy free": "خالي من الألبان",
  "vegan": "نباتي",
  "vegetarian": "نباتي",
  "halal": "حلال",
  "allergic": "حساسية",
  "allergy": "حساسية",

  // Portions / extras
  "extra": "زيادة",
  "double": "دبل",
  "triple": "تربل",
  "half": "نص",
  "small": "صغير",
  "large": "كبير",
  "big": "كبير",
  "more": "زيادة",
  "less": "أقل",
  "without": "بدون",
  "with": "مع",
  "no": "بدون",
  "add": "أضف",
  "remove": "شيل",
  "please": "لو سمحت",
  "thank you": "شكراً",
  "thanks": "شكراً",
  "urgent": "مستعجل",
  "rush": "مستعجل",
  "asap": "بسرعة",
  "fast": "بسرعة",
  "take your time": "على مهلكم",
  "for kids": "للأطفال",
  "for child": "للأطفال",
  "kid size": "حجم أطفال",

  // Drinks
  "no straw": "بدون شاليموه",
  "extra shot": "شوت زيادة",
  "double shot": "شوت دبل",
  "decaf": "بدون كافيين",
  "iced": "مثلج",
  "sweet": "حلو",
  "not too sweet": "مش حلو أوي",
  "bitter": "مر",
  "strong": "تقيل",
  "light": "خفيف",
  "extra foam": "رغوة زيادة",
  "no foam": "بدون رغوة",
  "whipped cream": "كريمة مخفوقة",
  "no whipped cream": "بدون كريمة مخفوقة",

  // ─── Ingredients: Fruits ───
  "mango": "مانجو",
  "strawberry": "فراولة",
  "guava": "جوافة",
  "watermelon": "بطيخ",
  "avocado": "أفوكادو",
  "orange": "برتقال",
  "banana": "موز",
  "kiwi": "كيوي",
  "blueberry": "بلوبيري",
  "raspberry": "توت",
  "berry": "توت",
  "berries": "توت",
  "pineapple": "أناناس",
  "pomegranate": "رمان",
  "apple": "تفاح",
  "coconut": "جوز هند",
  "fig": "تين",
  "peach": "خوخ",
  "grape": "عنب",
  "grapes": "عنب",
  "dates": "تمر",
  "passion fruit": "باشن فروت",
  "cherry": "كرز",

  // ─── Ingredients: Proteins ───
  "chicken": "فراخ",
  "beef": "لحم",
  "steak": "ستيك",
  "meat": "لحمة",
  "lamb": "لحم ضأن",
  "shrimp": "جمبري",
  "prawns": "جمبري",
  "calamari": "كاليماري",
  "squid": "حبار",
  "fish": "سمك",
  "salmon": "سلمون",
  "tuna": "تونة",
  "sea bass": "قاروص",
  "bacon": "بيكون",
  "sausage": "سجق",
  "turkey": "ديك رومي",
  "ham": "لانشون",
  "halloumi": "حلومي",
  "falafel": "فلافل",

  // ─── Ingredients: Vegetables ───
  "mushroom": "مشروم",
  "mushrooms": "مشروم",
  "olive": "زيتون",
  "olives": "زيتون",
  "spinach": "سبانخ",
  "corn": "ذرة",
  "potato": "بطاطس",
  "potatoes": "بطاطس",
  "fries": "بطاطس مقلية",
  "wedges": "ودجز",
  "cucumber": "خيار",
  "carrot": "جزر",
  "celery": "كرفس",
  "arugula": "جرجير",
  "rocket": "جرجير",
  "cabbage": "كرنب",
  "eggplant": "باذنجان",
  "zucchini": "كوسة",
  "beans": "فاصوليا",
  "lentils": "عدس",
  "chickpeas": "حمص",
  "hummus": "حمص",
  "peas": "بسلة",
  "jalapeno": "هالبينو",
  "bell pepper": "فلفل ألوان",

  // ─── Ingredients: Dairy & Cheese ───
  "cheese": "جبنة",
  "mozzarella": "موتزاريلا",
  "cheddar": "شيدر",
  "feta": "جبنة فيتا",
  "feta cheese": "جبنة فيتا",
  "parmesan": "بارميزان",
  "cream cheese": "جبنة كريمي",
  "milk": "حليب",
  "yogurt": "زبادي",
  "cream": "كريمة",
  "butter": "زبدة",
  "egg": "بيض",
  "eggs": "بيض",
  "sunny side": "عين",
  "scrambled": "مقلب",
  "omelet": "أومليت",
  "omelette": "أومليت",
  "boiled egg": "بيض مسلوق",
  "poached egg": "بيض مسلوق",

  // ─── Ingredients: Grains & Starches ───
  "bread": "خبز",
  "toast": "توست",
  "pita": "خبز بلدي",
  "croissant": "كرواسون",
  "rice": "أرز",
  "pasta": "باستا",
  "penne": "بيني",
  "linguine": "لينجويني",
  "spaghetti": "سباغيتي",
  "noodles": "نودلز",
  "baguette": "باجيت",
  "wrap": "راب",
  "tortilla": "تورتيلا",

  // ─── Ingredients: Sauces & Condiments ───
  "sauce": "صوص",
  "ketchup": "كاتشب",
  "mustard": "مسطردة",
  "mayo": "مايونيز",
  "mayonnaise": "مايونيز",
  "ranch": "رانش",
  "bbq": "باربيكيو",
  "bbq sauce": "صوص باربيكيو",
  "pesto": "بيستو",
  "tahini": "طحينة",
  "tzatziki": "تزاتزيكي",
  "salsa": "سالسا",
  "soy sauce": "صويا صوص",
  "vinegar": "خل",
  "honey": "عسل",
  "syrup": "شراب",
  "maple syrup": "شراب القيقب",
  "jam": "مربى",
  "tomato sauce": "صوص طماطم",
  "garlic sauce": "صوص ثوم",
  "hot sauce": "صوص حار",
  "chili sauce": "صوص شطة",
  "white sauce": "صوص أبيض",
  "red sauce": "صوص أحمر",
  "tartar sauce": "صوص ترتار",
  "truffle": "كمأة",
  "gravy": "جريفي",
  "dressing": "دريسنج",

  // ─── Ingredients: Spices & Herbs ───
  "salt": "ملح",
  "pepper": "فلفل",
  "black pepper": "فلفل أسود",
  "chili": "شطة",
  "chilli": "شطة",
  "paprika": "بابريكا",
  "cumin": "كمون",
  "cinnamon": "قرفة",
  "ginger": "زنجبيل",
  "saffron": "زعفران",
  "basil": "ريحان",
  "oregano": "أوريجانو",
  "thyme": "زعتر",
  "rosemary": "روزماري",
  "parsley": "بقدونس",
  "cilantro": "كزبرة",
  "dill": "شبت",
  "mint": "نعناع",
  "herbs": "أعشاب",
  "sesame": "سمسم",
  "capers": "كبر",

  // ─── Ingredients: Nuts ───
  "nuts": "مكسرات",
  "almond": "لوز",
  "almonds": "لوز",
  "walnut": "جوز",
  "walnuts": "جوز",
  "pistachio": "فستق",
  "hazelnut": "بندق",
  "hazelnuts": "بندق",
  "peanut": "فول سوداني",
  "peanuts": "فول سوداني",
  "cashew": "كاجو",
  "cashews": "كاجو",

  // ─── Ingredients: Sweets & Desserts ───
  "chocolate": "شوكولاتة",
  "dark chocolate": "شوكولاتة غامقة",
  "white chocolate": "شوكولاتة بيضاء",
  "nutella": "نوتيلا",
  "caramel": "كراميل",
  "vanilla": "فانيلا",
  "ice cream": "آيس كريم",
  "waffle": "وافل",
  "waffles": "وافل",
  "pancake": "بانكيك",
  "pancakes": "بانكيك",
  "oreo": "أوريو",
  "lotus": "لوتس",
  "kunafa": "كنافة",
  "sugar": "سكر",
  "brown sugar": "سكر بني",
  "coconut flakes": "رقائق جوز هند",
  "sprinkles": "سبرنكلز",
  "marshmallow": "مارشميلو",

  // ─── Beverages: Coffee & Tea ───
  "coffee": "قهوة",
  "espresso": "إسبريسو",
  "cappuccino": "كابتشينو",
  "latte": "لاتيه",
  "macchiato": "ماكياتو",
  "americano": "أمريكانو",
  "mocha": "موكا",
  "flat white": "فلات وايت",
  "cortado": "كورتادو",
  "turkish coffee": "قهوة تركي",
  "nescafe": "نسكافيه",
  "hot chocolate": "هوت شوكولت",
  "tea": "شاي",
  "green tea": "شاي أخضر",
  "black tea": "شاي أسود",
  "chamomile": "بابونج",
  "hibiscus": "كركديه",
  "anise": "ينسون",
  "sahlab": "سحلب",

  // ─── Beverages: Juices & Others ───
  "juice": "عصير",
  "smoothie": "سموذي",
  "milkshake": "ميلك شيك",
  "mojito": "موهيتو",
  "cocktail": "كوكتيل",
  "soda": "صودا",
  "cola": "كولا",
  "sprite": "سبرايت",
  "red bull": "ريد بول",
  "water": "ماية",
  "sparkling water": "ماء فوار",
  "mineral water": "مياه معدنية",
  "tonic": "تونيك",
  "lemonade": "ليمونادة",
  "frappe": "فرابيه",

  // ─── Dishes & Preparations ───
  "pizza": "بيتزا",
  "burger": "برجر",
  "sandwich": "ساندويتش",
  "salad": "سلطة",
  "soup": "شوربة",
  "shawarma": "شاورما",
  "quesadilla": "كساديا",
  "tacos": "تاكوس",
  "risotto": "ريزوتو",
  "stew": "طاجن",
  "roasted": "محمّر",
  "sauteed": "سوتيه",
  "poached": "مسلوق",
  "smoked": "مدخن",
  "stuffed": "محشي",
  "marinated": "متبّل",
  "baked": "مخبوز",

  // ─── Common "no X" combos for new ingredients ───
  "no mushroom": "بدون مشروم",
  "no mushrooms": "بدون مشروم",
  "no olives": "بدون زيتون",
  "no bacon": "بدون بيكون",
  "no chicken": "بدون فراخ",
  "no chocolate": "بدون شوكولاتة",
  "no honey": "بدون عسل",
  "no cinnamon": "بدون قرفة",
  "no peanuts": "بدون فول سوداني",
  "no sesame": "بدون سمسم",
  "no avocado": "بدون أفوكادو",
  "no cucumber": "بدون خيار",
  "no corn": "بدون ذرة",
  "no rice": "بدون أرز",
  "no fries": "بدون بطاطس",
  "extra mushroom": "مشروم زيادة",
  "extra olives": "زيتون زيادة",
  "extra bacon": "بيكون زيادة",
  "extra chicken": "فراخ زيادة",
  "extra honey": "عسل زيادة",
  "extra avocado": "أفوكادو زيادة",
  "extra fries": "بطاطس زيادة",
};

const SORTED_KEYS = Object.keys(DICT).sort((a, b) => b.length - a.length);

const FILLER = new Set(["add", "make", "make it", "i want", "i'd like", "can i get", "put", "give me", "do", "keep", "leave"]);

function translateSegment(seg: string): string | null {
  const s = seg.trim();
  if (!s) return null;

  const exact = DICT[s];
  if (exact) return exact;

  const words = s.split(/\s+/);
  const used = new Array(words.length).fill(false);
  const parts: { pos: number; ar: string }[] = [];

  for (const key of SORTED_KEYS) {
    const keyWords = key.split(/\s+/);
    for (let i = 0; i <= words.length - keyWords.length; i++) {
      if (used.slice(i, i + keyWords.length).some(Boolean)) continue;
      const window = words.slice(i, i + keyWords.length).join(" ");
      if (window === key) {
        for (let j = i; j < i + keyWords.length; j++) used[j] = true;
        parts.push({ pos: i, ar: DICT[key] });
        break;
      }
    }
  }

  if (parts.length === 0) return null;

  const leftover = words.filter((w, i) => !used[i] && !FILLER.has(w));
  if (leftover.length > 0) return null;

  parts.sort((a, b) => a.pos - b.pos);
  return parts.map((p) => p.ar).join(" ");
}

export function translateToArabic(text: string): string | null {
  if (!text) return null;
  if (/[\u0600-\u06FF]/.test(text)) return null;

  const lower = text.toLowerCase().trim();

  const exact = DICT[lower];
  if (exact) return exact;

  const segments = lower.split(/[,;.\/\-\n]+/);
  const translated: string[] = [];
  let anyMatched = false;

  for (const seg of segments) {
    const result = translateSegment(seg);
    if (result) {
      translated.push(result);
      anyMatched = true;
    }
  }

  return anyMatched ? translated.join("، ") : null;
}
