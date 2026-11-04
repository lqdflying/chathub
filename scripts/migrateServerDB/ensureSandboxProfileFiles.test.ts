// @vitest-environment node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

const {
  SANDBOX_PROFILE_FILES_SQL,
  ensureSandboxProfileFilesTable,
} = require('./ensureSandboxProfileFiles.cjs');

describe('ensureSandboxProfileFilesTable', () => {
  it('defines the table, both foreign key repairs and the partial unique indexes', () => {
    expect(SANDBOX_PROFILE_FILES_SQL).toContain(
      'CREATE TABLE IF NOT EXISTS "sandbox_profile_files"',
    );
    expect(SANDBOX_PROFILE_FILES_SQL).toContain(
      "conname = 'sandbox_profile_files_user_id_users_id_fk'",
    );
    expect(SANDBOX_PROFILE_FILES_SQL).toContain(
      "conname = 'sandbox_profile_files_updated_by_users_id_fk'",
    );
    expect(SANDBOX_PROFILE_FILES_SQL).toContain('WHERE "user_id" is null');
    expect(SANDBOX_PROFILE_FILES_SQL).toContain('WHERE "user_id" is not null');
  });

  it('matches the columns of migration 0071', () => {
    const migration = readFileSync(
      join(__dirname, '../../packages/database/migrations/0071_sandbox_profile_files.sql'),
      'utf8',
    );
    const columns = (sql: string) => [...sql.matchAll(/^\s*"(\w+)" /gm)].map((match) => match[1]);
    expect(columns(SANDBOX_PROFILE_FILES_SQL)).toEqual(columns(migration));
  });

  it('runs the repair SQL in a single query', async () => {
    const query = vi.fn().mockResolvedValue(undefined);
    await ensureSandboxProfileFilesTable({ query });
    expect(query).toHaveBeenCalledWith(SANDBOX_PROFILE_FILES_SQL);
  });

  it('is wired into the container migration and copied into the image', () => {
    const root = join(__dirname, '../..');
    expect(readFileSync(join(__dirname, 'docker.cjs'), 'utf8')).toContain(
      'await ensureSandboxProfileFilesTable(client);',
    );
    expect(readFileSync(join(root, 'Dockerfile'), 'utf8')).toContain(
      'COPY --from=builder /app/scripts/migrateServerDB/ensureSandboxProfileFiles.cjs /app/ensureSandboxProfileFiles.cjs',
    );
  });
});
