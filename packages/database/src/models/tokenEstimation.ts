import { and, eq } from 'drizzle-orm';

import { tokenEstimationProfiles } from '../schemas/tokenEstimation';
import { LobeChatDatabase } from '../type';

export class TokenEstimationModel {
  private userId: string;
  private db: LobeChatDatabase;

  constructor(db: LobeChatDatabase, userId: string) {
    this.userId = userId;
    this.db = db;
  }

  find = async (provider: string, model: string, estimatorRevision: number) => {
    const [row] = await this.db
      .select()
      .from(tokenEstimationProfiles)
      .where(
        and(
          eq(tokenEstimationProfiles.userId, this.userId),
          eq(tokenEstimationProfiles.provider, provider),
          eq(tokenEstimationProfiles.model, model),
          eq(tokenEstimationProfiles.estimatorRevision, estimatorRevision),
        ),
      )
      .limit(1);
    return row;
  };

  save = async ({
    estimatorRevision,
    ewma,
    model,
    provider,
    samples,
  }: {
    estimatorRevision: number;
    ewma: number;
    model: string;
    provider: string;
    samples: number;
  }) => {
    const current = await this.find(provider, model, estimatorRevision);
    const now = new Date();
    if (!current) {
      await this.db.insert(tokenEstimationProfiles).values({
        estimatorRevision,
        ewma,
        model,
        provider,
        samples,
        updatedAt: now,
        userId: this.userId,
      });
      return;
    }

    await this.db
      .update(tokenEstimationProfiles)
      .set({ ewma, samples, updatedAt: now })
      .where(
        and(
          eq(tokenEstimationProfiles.userId, this.userId),
          eq(tokenEstimationProfiles.provider, provider),
          eq(tokenEstimationProfiles.model, model),
          eq(tokenEstimationProfiles.estimatorRevision, estimatorRevision),
        ),
      );
  };
}
