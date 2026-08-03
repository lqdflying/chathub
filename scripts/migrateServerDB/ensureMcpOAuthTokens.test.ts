// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

const {
  MCP_OAUTH_TOKENS_SQL,
  ensureMcpOAuthTokensTable,
} = require('./ensureMcpOAuthTokens.cjs');

describe('ensureMcpOAuthTokensTable', () => {
  it('defines the server table and canonical user foreign key repair', () => {
    expect(MCP_OAUTH_TOKENS_SQL).toContain('CREATE TABLE IF NOT EXISTS "mcp_oauth_tokens"');
    expect(MCP_OAUTH_TOKENS_SQL).toContain('mcp_oauth_tokens_user_id_users_id_fk');
    expect(MCP_OAUTH_TOKENS_SQL).toContain(
      'DROP CONSTRAINT IF EXISTS "mcp_oauth_tokens_user_id_fkey"',
    );
    expect(MCP_OAUTH_TOKENS_SQL).toContain(
      'RENAME CONSTRAINT "mcp_oauth_tokens_user_id_fkey"',
    );
    expect(MCP_OAUTH_TOKENS_SQL).toContain('REFERENCES "public"."users"("id")');
  });

  it('runs the repair as one PostgreSQL statement', async () => {
    const query = vi.fn().mockResolvedValue({});

    await ensureMcpOAuthTokensTable({ query });

    expect(query).toHaveBeenCalledOnce();
    expect(query).toHaveBeenCalledWith(MCP_OAUTH_TOKENS_SQL);
  });
});
