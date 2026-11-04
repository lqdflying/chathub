// @vitest-environment node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

const { SANDBOX_JOBS_SQL, ensureSandboxJobsTable } = require('./ensureSandboxJobs.cjs');

describe('ensureSandboxJobsTable', () => {
  it('defines the jobs table, the owner foreign key repair and both indexes', () => {
    expect(SANDBOX_JOBS_SQL).toContain('CREATE TABLE IF NOT EXISTS "sandbox_jobs"');
    expect(SANDBOX_JOBS_SQL).toContain('"deadline_at" timestamp with time zone NOT NULL');
    expect(SANDBOX_JOBS_SQL).toContain("conname = 'sandbox_jobs_user_id_users_id_fk'");
    expect(SANDBOX_JOBS_SQL).toContain('ON DELETE cascade');
    expect(SANDBOX_JOBS_SQL).toContain(
      'CREATE INDEX IF NOT EXISTS "sandbox_jobs_user_session_idx"',
    );
    expect(SANDBOX_JOBS_SQL).toContain('CREATE INDEX IF NOT EXISTS "sandbox_jobs_user_status_idx"');
    expect(SANDBOX_JOBS_SQL).toContain(
      'ALTER TABLE "sandbox_jobs" ADD COLUMN IF NOT EXISTS "env_snapshot" text',
    );
    expect(SANDBOX_JOBS_SQL).toContain(
      'ALTER TABLE "sandbox_jobs" ADD COLUMN IF NOT EXISTS "file_snapshot" text',
    );
  });

  it('matches the columns of migration 0066', () => {
    const migration = readFileSync(
      join(__dirname, '../../packages/database/migrations/0066_sandbox_jobs.sql'),
      'utf8',
    );
    const columns = (sql: string) => [...sql.matchAll(/^\s*"(\w+)" /gm)].map((match) => match[1]);
    expect(columns(SANDBOX_JOBS_SQL)).toEqual(columns(migration));
  });

  it('runs the repair SQL in a single query', async () => {
    const query = vi.fn().mockResolvedValue(undefined);
    await ensureSandboxJobsTable({ query });
    expect(query).toHaveBeenCalledWith(SANDBOX_JOBS_SQL);
  });

  it('is wired into the container migration and copied into the image', () => {
    const root = join(__dirname, '../..');
    expect(readFileSync(join(__dirname, 'docker.cjs'), 'utf8')).toContain(
      'await ensureSandboxJobsTable(client);',
    );
    expect(readFileSync(join(root, 'Dockerfile'), 'utf8')).toContain(
      'COPY --from=builder /app/scripts/migrateServerDB/ensureSandboxJobs.cjs /app/ensureSandboxJobs.cjs',
    );
  });
});
