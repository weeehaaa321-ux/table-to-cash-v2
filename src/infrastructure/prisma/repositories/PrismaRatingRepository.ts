import { db } from "../client";
import { env } from "../../config/env";
import type { RatingRepository, RatingInput } from "@/application/ports/RatingRepository";
import { Rating } from "@/domain/rating/Rating";
import { makeId } from "@/domain/shared/Identifier";

let cachedRestaurantId: string | null = null;
async function getRestaurantId(): Promise<string> {
  if (cachedRestaurantId) return cachedRestaurantId;
  const r = await db.restaurant.findUnique({
    where: { slug: env.RESTAURANT_SLUG },
    select: { id: true },
  });
  if (!r) throw new Error(`No Restaurant slug=${env.RESTAURANT_SLUG}`);
  cachedRestaurantId = r.id;
  return r.id;
}

export class PrismaRatingRepository implements RatingRepository {
  async upsertForSession(input: RatingInput): Promise<Rating> {
    const restaurantId = await getRestaurantId();
    const row = await db.rating.upsert({
      where: { sessionId: input.sessionId },
      create: {
        sessionId: input.sessionId,
        restaurantId,
        food: input.food,
        service: input.service,
        hygiene: input.hygiene,
        comment: input.comment,
      },
      update: {
        food: input.food,
        service: input.service,
        hygiene: input.hygiene,
        comment: input.comment,
      },
    });
    return Rating.rehydrate({
      id: makeId<"Rating">(row.id),
      sessionId: makeId<"TableSession">(row.sessionId),
      food: row.food,
      service: row.service,
      hygiene: row.hygiene,
      comment: row.comment,
      createdAt: row.createdAt,
    });
  }
}
