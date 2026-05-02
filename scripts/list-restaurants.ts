import "dotenv/config";
import { db } from "../src/lib/db";
(async () => {
  const r = await db.restaurant.findMany({ select: { id: true, name: true, slug: true } });
  console.log(r);
})().finally(() => db.$disconnect());
