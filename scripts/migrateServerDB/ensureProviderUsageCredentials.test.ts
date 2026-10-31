// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

const {
  PROVIDER_USAGE_CREDENTIALS_SQL,
  ensureProviderUsageCredentialsTable,
} = require('./ensureProviderUsageCredentials.cjs');

describe('ensureProviderUsageCredentialsTable', () => {
  it('defines the server-only table, composite key, and user foreign key repair', () => {
    expect(PROVIDER_USAGE_CREDENTIALS_SQL).toContain(
      'CREATE TABLE IF NOT EXISTS "provider_usage_credentials"',
    );
    expect(PROVIDER_USAGE_CREDENTIALS_SQL).toContain('PRIMARY KEY("user_id","provider")');
    expect(PROVIDER_USAGE_CREDENTIALS_SQL).toContain(
      "conname = 'provider_usage_credentials_user_id_users_id_fk'",
    );
    expect(PROVIDER_USAGE_CREDENTIALS_SQL).toContain('REFERENCES "public"."users"("id")');
    expect(PROVIDER_USAGE_CREDENTIALS_SQL).toContain('ON DELETE cascade');
  });

  it('runs the repair SQL in a single query', async () => {
    const query = vi.fn().mockResolvedValue(undefined);
    await ensureProviderUsageCredentialsTable({ query });
    expect(query).toHaveBeenCalledTimes(1);
    expect(query).toHaveBeenCalledWith(PROVIDER_USAGE_CREDENTIALS_SQL);
  });
});
