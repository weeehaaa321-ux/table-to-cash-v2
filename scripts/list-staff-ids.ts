import "dotenv/config";
import { db } from "../src/lib/db";

async function main() {
  const staff = await db.staff.findMany({
    where: { active: true },
    select: { id: true, name: true, role: true },
    orderBy: [{ role: "asc" }, { name: "asc" }],
  });
  for (const s of staff) console.log(`${s.role.padEnd(15)} ${s.id}  ${s.name}`);
}
main().finally(() => db.$disconnect());
