import type { Identifier } from "../shared/Identifier";
import type { SessionId } from "../session/TableSession";

export type RatingId = Identifier<"Rating">;

/**
 * Rating — guest's post-visit rating across three axes (food, service,
 * hygiene), 0–5 each, plus optional comment. One rating per session
 * (DB unique constraint on sessionId).
 *
 * Source repo invariants:
 *   - 0 means "not rated" (initial state); 1–5 are real ratings
 *   - All three axes are stored even if guest only rated some
 */
export class Rating {
  private constructor(
    public readonly id: RatingId,
    public readonly sessionId: SessionId,
    public readonly food: number,
    public readonly service: number,
    public readonly hygiene: number,
    public readonly comment: string | null,
    public readonly createdAt: Date,
  ) {}

  static rehydrate(props: {
    id: RatingId;
    sessionId: SessionId;
    food: number;
    service: number;
    hygiene: number;
    comment: string | null;
    createdAt: Date;
  }): Rating {
    return new Rating(
      props.id,
      props.sessionId,
      props.food,
      props.service,
      props.hygiene,
      props.comment,
      props.createdAt,
    );
  }

  averageScore(): number {
    const scores = [this.food, this.service, this.hygiene].filter((s) => s > 0);
    if (scores.length === 0) return 0;
    return scores.reduce((a, b) => a + b, 0) / scores.length;
  }
}
