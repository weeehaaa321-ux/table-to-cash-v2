import "dotenv/config";
import { randomBytes } from "crypto";
import { db } from "../src/lib/db";

async function main() {
  const checked = await db.reservation.findMany({
    where: { status: { in: ["CHECKED_IN", "CHECKED_OUT"] }, stayToken: null },
    select: { id: true, guest: { select: { name: true } }, room: { select: { number: true } } },
  });
  console.log(`Backfilling tokens for ${checked.length} reservations…`);
  for (const r of checked) {
    const token = randomBytes(13).toString("base64url");
    await db.reservation.update({
      where: { id: r.id },
      data: { stayToken: token },
    });
    console.log(`  ${r.guest.name} (Room ${r.room.number}): /stay/${token}`);
  }
  console.log("Done.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
