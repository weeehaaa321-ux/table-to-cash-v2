// One-off: reset a specific OWNER's PIN.
// Usage:
//   $env:DATABASE_URL="<prod-url>"; $env:OWNER_ID="<id>"; $env:NEW_PIN="1234"; npx tsx scripts/reset-owner-pin.ts

import { db } from "../src/lib/db";
import bcrypt from "bcryptjs";

async function main() {
  const ownerId = process.env.OWNER_ID?.trim();
  const newPin = process.env.NEW_PIN?.trim();
  if (!ownerId || !newPin) { console.error("Set OWNER_ID and NEW_PIN."); process.exit(1); }
  if (!/^\d{4,8}$/.test(newPin)) { console.error("NEW_PIN must be 4-8 digits."); process.exit(1); }

  const owner = await db.staff.findUnique({ where: { id: ownerId }, select: { id: true, name: true, role: true } });
  if (!owner) { console.error(`No staff with id ${ownerId}.`); process.exit(1); }
  if (owner.role !== "OWNER") { console.error(`${owner.name} is ${owner.role}, not OWNER. Aborting.`); process.exit(1); }

  const hashedPin = await bcrypt.hash(newPin, 10);
  await db.staff.update({ where: { id: ownerId }, data: { pin: hashedPin } });
  console.log(`Reset PIN for ${owner.name} (${owner.id}) to "${newPin}".`);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => db.$disconnect());
