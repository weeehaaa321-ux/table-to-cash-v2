import { db } from "../src/lib/db";

async function main() {
  const owners = await db.staff.findMany({
    where: { role: "OWNER" },
    select: { id: true, name: true, active: true, restaurantId: true, createdAt: true },
    orderBy: { createdAt: "desc" },
  });
  console.log(JSON.stringify(owners, null, 2));
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => db.$disconnect());
