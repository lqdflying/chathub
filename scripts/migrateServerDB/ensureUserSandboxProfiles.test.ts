// @vitest-environment node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

const {
  USER_SANDBOX_PROFILES_SQL,
  ensureUserSandboxProfilesTable,
} = require('./ensureUserSandboxProfiles.cjs');

describe('ensureUserSandboxProfilesTable', () => {
  it('defines the Hub state table, composite key, and user foreign key repair', () => {
    expect(USER_SANDBOX_PROFILES_SQL).toContain(
      'CREATE TABLE IF NOT EXISTS "user_sandbox_profiles"',
    );
    expect(USER_SANDBOX_PROFILES_SQL).toContain('PRIMARY KEY("user_id","profile_id")');
    expect(USER_SANDBOX_PROFILES_SQL).toContain('"enabled" boolean NOT NULL');
    expect(USER_SANDBOX_PROFILES_SQL).toContain(
      "conname = 'user_sandbox_profiles_user_id_users_id_fk'",
    );
    expect(USER_SANDBOX_PROFILES_SQL).toContain('ON DELETE cascade');
  });

  it('runs the repair SQL in a single query', async () => {
    const query = vi.fn().mockResolvedValue(undefined);
    await ensureUserSandboxProfilesTable({ query });
    expect(query).toHaveBeenCalledWith(USER_SANDBOX_PROFILES_SQL);
  });

  it('is wired into the container migration and copied into the image', () => {
    const root = join(__dirname, '../..');
    expect(readFileSync(join(__dirname, 'docker.cjs'), 'utf8')).toContain(
      'await ensureUserSandboxProfilesTable(client);',
    );
    expect(readFileSync(join(root, 'Dockerfile'), 'utf8')).toContain(
      'COPY --from=builder /app/scripts/migrateServerDB/ensureUserSandboxProfiles.cjs /app/ensureUserSandboxProfiles.cjs',
    );
  });
});
