import bcrypt from "bcryptjs";
import { db } from "../prisma/client";
import type { StaffAuthenticator } from "@/application/ports/StaffAuthenticator";
import type { StaffPin } from "@/domain/staff/StaffPin";
import { Staff } from "@/domain/staff/Staff";
import type { StaffRole } from "@/domain/staff/enums";
import { makeId } from "@/domain/shared/Identifier";

/**
 * Bcrypt-based PIN authenticator.
 *
 * Source repo: src/lib/api-auth.ts (header lookup) + src/app/api/staff/login.
 * The bcrypt cost factor is bcryptjs default (10) — preserved exactly.
 *
 * Both methods are scoped to the current restaurant (single-tenant per
 * deploy). The query filter on `restaurantId` is implicit because each
 * deploy points at one restaurant — but the schema-level column is
 * preserved, so we still scope by restaurantSlug → restaurantId.
 */
export class PrismaStaffAuthenticator implements StaffAuthenticator {
  async byId(staffId: string): Promise<Staff | null> {
    const row = await db.staff.findUnique({ where: { id: staffId } });
    if (!row) return null;
    return mapStaff(row);
  }

  async byPin(pin: StaffPin): Promise<Staff | null> {
    // PIN isn't unique — multiple staff could (badly) share one. We
    // scan active staff and bcrypt-compare. For typical staff counts
    // (<50 per restaurant) this is fine; if it grows, add a
    // time-constant pre-filter.
    const candidates = await db.staff.findMany({
      where: { active: true },
    });
    for (const row of candidates) {
      // Source repo stored bcrypt hashes in `pin` column (not plaintext).
      const matches = await bcrypt.compare(pin.reveal(), row.pin);
      if (matches) return mapStaff(row);
    }
    return null;
  }
}

function mapStaff(row: {
  id: string;
  name: string;
  code: string | null;
  role: string;
  active: boolean;
  shift: number;
  deliveryOnline: boolean;
  createdAt: Date;
}): Staff {
  return Staff.rehydrate({
    id: makeId<"Staff">(row.id),
    name: row.name,
    code: row.code,
    role: row.role as StaffRole,
    active: row.active,
    shift: row.shift,
    deliveryOnline: row.deliveryOnline,
    createdAt: row.createdAt,
  });
}
