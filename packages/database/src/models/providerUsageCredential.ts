import { and, eq } from 'drizzle-orm';

import { providerUsageCredentials } from '../schemas/providerUsage';
import { LobeChatDatabase } from '../type';

export class ProviderUsageCredentialModel {
  private userId: string;
  private db: LobeChatDatabase;

  constructor(db: LobeChatDatabase, userId: string) {
    this.userId = userId;
    this.db = db;
  }

  find = async (provider: string) => {
    const [row] = await this.db
      .select()
      .from(providerUsageCredentials)
      .where(
        and(
          eq(providerUsageCredentials.userId, this.userId),
          eq(providerUsageCredentials.provider, provider),
        ),
      )
      .limit(1);
    return row;
  };

  upsert = async ({
    credential,
    keyHint,
    provider,
  }: {
    credential: string;
    keyHint: string;
    provider: string;
  }) => {
    const now = new Date();
    await this.db
      .insert(providerUsageCredentials)
      .values({ credential, keyHint, provider, updatedAt: now, userId: this.userId })
      .onConflictDoUpdate({
        set: { credential, keyHint, updatedAt: now },
        target: [providerUsageCredentials.userId, providerUsageCredentials.provider],
      });
  };

  delete = async (provider: string) => {
    await this.db
      .delete(providerUsageCredentials)
      .where(
        and(
          eq(providerUsageCredentials.userId, this.userId),
          eq(providerUsageCredentials.provider, provider),
        ),
      );
  };
}
