// @vitest-environment node
import { PGlite } from '@electric-sql/pglite';
import { afterEach, describe, expect, it } from 'vitest';

const {
  CONVERSATION_VERSION_SQL,
  ensureConversationVersionColumn,
} = require('./ensureConversationVersion.cjs');

describe('ensureConversationVersionColumn', () => {
  let client: PGlite | undefined;

  afterEach(async () => {
    await client?.close();
    client = undefined;
  });

  it('creates the dedicated conversation version with the required constraints', async () => {
    client = new PGlite();
    await client.exec(`
      CREATE TABLE "users" (
        "id" text PRIMARY KEY NOT NULL
      );
      INSERT INTO "users" ("id") VALUES ('user-1');
    `);

    await client.exec(CONVERSATION_VERSION_SQL);

    const users = await client.query<{ conversation_version: number }>(`
      SELECT "conversation_version"
      FROM "users"
      WHERE "id" = 'user-1';
    `);
    expect(users.rows).toEqual([{ conversation_version: 0 }]);

    const columns = await client.query<{
      column_default: string;
      is_nullable: string;
    }>(`
      SELECT column_default, is_nullable
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'users'
        AND column_name = 'conversation_version';
    `);
    expect(columns.rows).toEqual([{ column_default: '0', is_nullable: 'NO' }]);
  });

  it('repairs a partial nullable column and preserves existing versions', async () => {
    client = new PGlite();
    await client.exec(`
      CREATE TABLE "users" (
        "id" text PRIMARY KEY NOT NULL,
        "conversation_version" integer
      );
      INSERT INTO "users" ("id", "conversation_version")
      VALUES ('user-1', NULL), ('user-2', 7);
    `);

    await ensureConversationVersionColumn(client);

    const users = await client.query<{ conversation_version: number; id: string }>(`
      SELECT "id", "conversation_version"
      FROM "users"
      ORDER BY "id";
    `);
    expect(users.rows).toEqual([
      { conversation_version: 0, id: 'user-1' },
      { conversation_version: 7, id: 'user-2' },
    ]);
  });
});
