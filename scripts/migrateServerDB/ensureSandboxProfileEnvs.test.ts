// @vitest-environment node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

const {
  SANDBOX_PROFILE_ENVS_SQL,
  ensureSandboxProfileEnvsTable,
} = require('./ensureSandboxProfileEnvs.cjs');

describe('ensureSandboxProfileEnvsTable', () => {
  it('defines the table, both foreign key repairs and the partial unique indexes', () => {
    expect(SANDBOX_PROFILE_ENVS_SQL).toContain('CREATE TABLE IF NOT EXISTS "sandbox_profile_envs"');
    expect(SANDBOX_PROFILE_ENVS_SQL).toContain(
      "conname = 'sandbox_profile_envs_user_id_users_id_fk'",
    );
    expect(SANDBOX_PROFILE_ENVS_SQL).toContain(
      "conname = 'sandbox_profile_envs_updated_by_users_id_fk'",
    );
    expect(SANDBOX_PROFILE_ENVS_SQL).toContain('WHERE "user_id" is null');
    expect(SANDBOX_PROFILE_ENVS_SQL).toContain('WHERE "user_id" is not null');
    expect(SANDBOX_PROFILE_ENVS_SQL).toContain(
      'ADD COLUMN IF NOT EXISTS "sensitive" boolean DEFAULT true NOT NULL',
    );
  });

  it('matches the columns of migration 0068', () => {
    const migration = readFileSync(
      join(__dirname, '../../packages/database/migrations/0068_sandbox_profile_envs.sql'),
      'utf8',
    );
    const columns = (sql: string) => [...sql.matchAll(/^\s*"(\w+)" /gm)].map((match) => match[1]);
    expect(columns(SANDBOX_PROFILE_ENVS_SQL)).toEqual(columns(migration));
  });

  it('runs the repair SQL in a single query', async () => {
    const query = vi.fn().mockResolvedValue(undefined);
    await ensureSandboxProfileEnvsTable({ query });
    expect(query).toHaveBeenCalledWith(SANDBOX_PROFILE_ENVS_SQL);
  });

  it('is wired into the container migration and copied into the image', () => {
    const root = join(__dirname, '../..');
    expect(readFileSync(join(__dirname, 'docker.cjs'), 'utf8')).toContain(
      'await ensureSandboxProfileEnvsTable(client);',
    );
    expect(readFileSync(join(root, 'Dockerfile'), 'utf8')).toContain(
      'COPY --from=builder /app/scripts/migrateServerDB/ensureSandboxProfileEnvs.cjs /app/ensureSandboxProfileEnvs.cjs',
    );
  });
});
