// @vitest-environment node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

const {
  SANDBOX_HUB_PROFILES_SQL,
  ensureSandboxHubProfilesTable,
} = require('./ensureSandboxHubProfiles.cjs');

describe('ensureSandboxHubProfilesTable', () => {
  it('defines the shared profiles table and the editor foreign key repair', () => {
    expect(SANDBOX_HUB_PROFILES_SQL).toContain('CREATE TABLE IF NOT EXISTS "sandbox_hub_profiles"');
    expect(SANDBOX_HUB_PROFILES_SQL).toContain(
      "conname = 'sandbox_hub_profiles_updated_by_users_id_fk'",
    );
    expect(SANDBOX_HUB_PROFILES_SQL).toContain('ON DELETE set null');
    // Migration 0073.
    expect(SANDBOX_HUB_PROFILES_SQL).toContain(
      'ALTER TABLE "sandbox_hub_profiles" ADD COLUMN IF NOT EXISTS "persistent_folder" text;',
    );
  });

  it('matches the columns of migration 0067', () => {
    const migration = readFileSync(
      join(__dirname, '../../packages/database/migrations/0067_sandbox_hub_profiles.sql'),
      'utf8',
    );
    const columns = (sql: string) => [...sql.matchAll(/^\s*"(\w+)" /gm)].map((match) => match[1]);
    expect(columns(SANDBOX_HUB_PROFILES_SQL)).toEqual(columns(migration));
  });

  it('runs the repair SQL in a single query', async () => {
    const query = vi.fn().mockResolvedValue(undefined);
    await ensureSandboxHubProfilesTable({ query });
    expect(query).toHaveBeenCalledWith(SANDBOX_HUB_PROFILES_SQL);
  });

  it('is wired into the container migration and copied into the image', () => {
    const root = join(__dirname, '../..');
    expect(readFileSync(join(__dirname, 'docker.cjs'), 'utf8')).toContain(
      'await ensureSandboxHubProfilesTable(client);',
    );
    expect(readFileSync(join(root, 'Dockerfile'), 'utf8')).toContain(
      'COPY --from=builder /app/scripts/migrateServerDB/ensureSandboxHubProfiles.cjs /app/ensureSandboxHubProfiles.cjs',
    );
  });
});
