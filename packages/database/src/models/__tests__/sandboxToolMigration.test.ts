// @vitest-environment node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { eq, sql } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';

import { agents, userSettings, users } from '../../schemas';
import { LobeChatDatabase } from '../../type';
import { getTestDB } from './_util';

const serverDB: LobeChatDatabase = await getTestDB();

const migration = readFileSync(
  join(__dirname, '../../../migrations/0062_sandbox_tool_identifier.sql'),
  'utf8',
);

// getTestDB already applied it to an empty database; run it again on fixtures.
const runMigration = async () => {
  for (const statement of migration.split('--> statement-breakpoint')) {
    await serverDB.execute(sql.raw(statement));
  }
};

const userId = 'sandbox-migration-user';

const pluginsOf = async (id: string) =>
  (await serverDB.select({ plugins: agents.plugins }).from(agents).where(eq(agents.id, id)))[0]
    ?.plugins;

describe('0062_sandbox_tool_identifier', () => {
  beforeEach(async () => {
    await serverDB.delete(users);
    await serverDB.insert(users).values({ id: userId });
  });

  it('renames the Code Interpreter in agent plugin lists, keeping order and one entry', async () => {
    await serverDB.insert(agents).values([
      { id: 'legacy', plugins: ['mcp__notion', 'lobe-code-interpreter', 'lobe-artifacts'], userId },
      { id: 'both', plugins: ['lobe-code-interpreter', 'y', 'lobe-sandbox'], userId },
      { id: 'untouched', plugins: ['mcp__x'], userId },
      { id: 'empty', plugins: [], userId },
    ]);

    await runMigration();
    await runMigration();

    expect(await pluginsOf('legacy')).toEqual(['mcp__notion', 'lobe-sandbox', 'lobe-artifacts']);
    expect(await pluginsOf('both')).toEqual(['lobe-sandbox', 'y']);
    expect(await pluginsOf('untouched')).toEqual(['mcp__x']);
    expect(await pluginsOf('empty')).toEqual([]);
  });

  it('renames it in the default agent settings without touching other fields', async () => {
    await serverDB.insert(userSettings).values({
      defaultAgent: {
        config: { model: 'gpt', plugins: ['lobe-code-interpreter', 'p2'] },
        meta: { title: 'Default' },
      },
      id: userId,
    });

    await runMigration();

    const [row] = await serverDB
      .select({ defaultAgent: userSettings.defaultAgent })
      .from(userSettings)
      .where(eq(userSettings.id, userId));
    expect(row.defaultAgent).toEqual({
      config: { model: 'gpt', plugins: ['lobe-sandbox', 'p2'] },
      meta: { title: 'Default' },
    });
  });
});
