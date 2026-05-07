import "dotenv/config";
import { db } from "../src/lib/db";

async function main() {
  const sample = await db.guest.findFirst({ select: { id: true, isPlaceholder: true } });
  const rt = await db.roomType.findFirst({ select: { id: true, icalExportToken: true } });
  const r = await db.reservation.findFirst({
    select: { id: true, icalSourceRoom: true, externalUid: true },
  });
  console.log("Guest.isPlaceholder OK:", sample);
  console.log("RoomType.icalExportToken OK:", rt);
  console.log("Reservation.icalSourceRoom OK:", r);
  const dupes = await db.reservation.groupBy({
    by: ["hotelId", "externalUid"],
    where: { externalUid: { not: null } },
    _count: true,
    having: { externalUid: { _count: { gt: 1 } } },
  });
  console.log("Dupe externalUid count (should be 0):", dupes.length);
  const unflagged = await db.guest.count({
    where: { name: { endsWith: " guest" }, isPlaceholder: false },
  });
  console.log("Unflagged placeholder candidates (should be 0):", unflagged);
  const mailCount = await db.mailLog.count();
  console.log("MailLog rows:", mailCount);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
