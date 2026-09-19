// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

const {
  OPENAI_CODEX_OAUTH_TOKENS_SQL,
  ensureOpenAICodexOAuthTokensTable,
} = require('./ensureOpenAICodexOAuthTokens.cjs');

describe('ensureOpenAICodexOAuthTokensTable', () => {
  it('defines the server table and canonical user foreign key repair', () => {
    expect(OPENAI_CODEX_OAUTH_TOKENS_SQL).toContain(
      'CREATE TABLE IF NOT EXISTS "openai_codex_oauth_tokens"',
    );
    expect(OPENAI_CODEX_OAUTH_TOKENS_SQL).toContain(
      'openai_codex_oauth_tokens_user_id_users_id_fk',
    );
    expect(OPENAI_CODEX_OAUTH_TOKENS_SQL).toContain(
      'openai_codex_oauth_tokens_user_id_unique',
    );
    expect(OPENAI_CODEX_OAUTH_TOKENS_SQL).toContain(
      'DROP CONSTRAINT IF EXISTS "openai_codex_oauth_tokens_user_id_fkey"',
    );
    expect(OPENAI_CODEX_OAUTH_TOKENS_SQL).toContain(
      'RENAME CONSTRAINT "openai_codex_oauth_tokens_user_id_fkey"',
    );
    expect(OPENAI_CODEX_OAUTH_TOKENS_SQL).toContain('REFERENCES "public"."users"("id")');
    expect(OPENAI_CODEX_OAUTH_TOKENS_SQL).toContain(
      'ADD COLUMN IF NOT EXISTS "refresh_lock_id"',
    );
    expect(OPENAI_CODEX_OAUTH_TOKENS_SQL).toContain(
      'ADD COLUMN IF NOT EXISTS "refresh_lock_until"',
    );
  });

  it('runs the repair as one PostgreSQL statement', async () => {
    const query = vi.fn().mockResolvedValue({});

    await ensureOpenAICodexOAuthTokensTable({ query });

    expect(query).toHaveBeenCalledOnce();
    expect(query).toHaveBeenCalledWith(OPENAI_CODEX_OAUTH_TOKENS_SQL);
  });
});
