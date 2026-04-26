import type { Rating } from "@/domain/rating/Rating";

export type RatingInput = {
  sessionId: string;
  food: number;
  service: number;
  hygiene: number;
  comment: string | null;
};

export interface RatingRepository {
  upsertForSession(input: RatingInput): Promise<Rating>;
}
