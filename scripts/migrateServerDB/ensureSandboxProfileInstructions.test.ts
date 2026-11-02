// @vitest-environment node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

const {
  SANDBOX_PROFILE_INSTRUCTIONS_SQL,
  ensureSandboxProfileInstructionsTable,
} = require('./ensureSandboxProfileInstructions.cjs');

describe('ensureSandboxProfileInstructionsTable', () => {
  it('defines the shared instruction table and the editor foreign key repair', () => {
    expect(SANDBOX_PROFILE_INSTRUCTIONS_SQL).toContain(
      'CREATE TABLE IF NOT EXISTS "sandbox_profile_instructions"',
    );
    expect(SANDBOX_PROFILE_INSTRUCTIONS_SQL).toContain('"profile_id" text PRIMARY KEY NOT NULL');
    expect(SANDBOX_PROFILE_INSTRUCTIONS_SQL).toContain(
      "conname = 'sandbox_profile_instructions_updated_by_users_id_fk'",
    );
    expect(SANDBOX_PROFILE_INSTRUCTIONS_SQL).toContain('ON DELETE set null');
  });

  it('runs the repair SQL in a single query', async () => {
    const query = vi.fn().mockResolvedValue(undefined);
    await ensureSandboxProfileInstructionsTable({ query });
    expect(query).toHaveBeenCalledWith(SANDBOX_PROFILE_INSTRUCTIONS_SQL);
  });

  it('is wired into the container migration and copied into the image', () => {
    const root = join(__dirname, '../..');
    expect(readFileSync(join(__dirname, 'docker.cjs'), 'utf8')).toContain(
      'await ensureSandboxProfileInstructionsTable(client);',
    );
    expect(readFileSync(join(root, 'Dockerfile'), 'utf8')).toContain(
      'COPY --from=builder /app/scripts/migrateServerDB/ensureSandboxProfileInstructions.cjs /app/ensureSandboxProfileInstructions.cjs',
    );
  });
});
