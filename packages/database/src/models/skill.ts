import { and, desc, eq } from 'drizzle-orm';
import type { InstalledSkillItem } from '@lobechat/types';

import { NewInstalledSkill, userInstalledSkills } from '../schemas';
import { LobeChatDatabase } from '../type';

export class SkillModel {
  private db: LobeChatDatabase;
  private userId: string;

  constructor(db: LobeChatDatabase, userId: string) {
    this.db = db;
    this.userId = userId;
  }

  create = async (params: Omit<NewInstalledSkill, 'userId'>) => {
    const [result] = await this.db
      .insert(userInstalledSkills)
      .values({ ...params, userId: this.userId })
      .onConflictDoUpdate({
        set: { ...params, updatedAt: new Date() },
        target: [userInstalledSkills.userId, userInstalledSkills.identifier],
      })
      .returning();

    return result;
  };

  delete = async (identifier: string) =>
    this.db
      .delete(userInstalledSkills)
      .where(
        and(
          eq(userInstalledSkills.identifier, identifier),
          eq(userInstalledSkills.userId, this.userId),
        ),
      );

  query = async (): Promise<InstalledSkillItem[]> =>
    this.db
      .select({
        contentHash: userInstalledSkills.contentHash,
        createdAt: userInstalledSkills.createdAt,
        description: userInstalledSkills.description,
        identifier: userInstalledSkills.identifier,
        name: userInstalledSkills.name,
        sourceRef: userInstalledSkills.sourceRef,
        sourceType: userInstalledSkills.sourceType,
        sourceUrl: userInstalledSkills.sourceUrl,
        updatedAt: userInstalledSkills.updatedAt,
      })
      .from(userInstalledSkills)
      .where(eq(userInstalledSkills.userId, this.userId))
      .orderBy(desc(userInstalledSkills.createdAt));

  findById = async (identifier: string) =>
    this.db.query.userInstalledSkills.findFirst({
      where: and(
        eq(userInstalledSkills.identifier, identifier),
        eq(userInstalledSkills.userId, this.userId),
      ),
    });

  deleteAll = async () =>
    this.db.delete(userInstalledSkills).where(eq(userInstalledSkills.userId, this.userId));
}
