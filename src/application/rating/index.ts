import type { RatingRepository, RatingInput } from "../ports/RatingRepository";
import type { Rating } from "@/domain/rating/Rating";

export class SubmitRatingUseCase {
  constructor(private readonly repo: RatingRepository) {}
  async execute(input: RatingInput): Promise<Rating> {
    return this.repo.upsertForSession({
      sessionId: input.sessionId,
      food: input.food || 0,
      service: input.service || 0,
      hygiene: input.hygiene || 0,
      comment: input.comment,
    });
  }
}
