const { join } = require('node:path');
const { Pool } = require('pg');
const { drizzle } = require('drizzle-orm/node-postgres');
const migrator = require('drizzle-orm/node-postgres/migrator');
const { PGVECTOR_HINT } = require('./errorHint');
const { ensureAgentAssistantMemoryColumn } = require('./ensureAgentAssistantMemory.cjs');
const { ensureMessageOrderColumn } = require('./ensureMessageOrder.cjs');
const { ensureMcpOAuthTokensTable } = require('./ensureMcpOAuthTokens.cjs');
const { ensurePicbedImagesTable } = require('./ensurePicbedImages.cjs');

// SAFETY NET: Every new Drizzle migration that adds a table or column MUST also
// add a corresponding ensure* call here. This protects against journal drift —
// deployments where __drizzle_migrations says the migration ran but the table
// was never actually created (failed build, DB restore, partial transaction).
//
// Pattern: CREATE TABLE IF NOT EXISTS / ALTER TABLE ADD COLUMN IF NOT EXISTS.
// These are idempotent and safe to run on every startup.

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is not set, please set it in your environment variables.');
}

const client = new Pool({ connectionString: process.env.DATABASE_URL });

const db = drizzle(client);

const runMigrations = async () => {
  console.log('[Database] Start to migration...');
  await migrator.migrate(db, {
    migrationsFolder: join(__dirname, './migrations'),
  });

  await ensureAgentAssistantMemoryColumn(client);
  await ensureMcpOAuthTokensTable(client);
  await ensurePicbedImagesTable(client);
  await ensureMessageOrderColumn(client);

  console.log('✅ database migration pass.');
  console.log('-------------------------------------');
  // eslint-disable-next-line unicorn/no-process-exit
  process.exit(0);
};

// eslint-disable-next-line unicorn/prefer-top-level-await
runMigrations().catch((err) => {
  console.error(
    '❌ Database migrate failed. Please check your database is valid and DATABASE_URL is set correctly. The error detail is below:',
  );
  console.error(err);

  if (err.message.includes('extension "vector" is not available')) {
    console.info(PGVECTOR_HINT);
  }

  // eslint-disable-next-line unicorn/no-process-exit
  process.exit(1);
});
