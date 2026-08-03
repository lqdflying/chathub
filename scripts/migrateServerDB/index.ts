import * as dotenv from 'dotenv';
import { sql } from 'drizzle-orm';
import { migrate as neonMigrate } from 'drizzle-orm/neon-serverless/migrator';
import { migrate as nodeMigrate } from 'drizzle-orm/node-postgres/migrator';
import { createRequire } from 'node:module';
import { join } from 'node:path';

// @ts-ignore tsgo handle esm import cjs and compatibility issues
import { DB_FAIL_INIT_HINT, PGVECTOR_HINT } from './errorHint';

const require = createRequire(import.meta.url);
const { AGENT_ASSISTANT_MEMORY_SQL } = require('./ensureAgentAssistantMemory.cjs') as {
  AGENT_ASSISTANT_MEMORY_SQL: string;
};
const { CHAT_GROUP_MEMBERSHIP_OWNERSHIP_SQL } =
  require('./ensureChatGroupMembershipOwnership.cjs') as {
    CHAT_GROUP_MEMBERSHIP_OWNERSHIP_SQL: string;
  };

// Read the `.env` file if it exists, or a file specified by the
// dotenv_config_path parameter that's passed to Node.js
dotenv.config();

const migrationsFolder = join(__dirname, '../../packages/database/migrations');

const runMigrations = async () => {
  const { serverDB } = await import('../../packages/database/src/server');

  if (process.env.DATABASE_DRIVER === 'node') {
    await nodeMigrate(serverDB, { migrationsFolder });
  } else {
    await neonMigrate(serverDB, { migrationsFolder });
  }

  await serverDB.execute(sql.raw(AGENT_ASSISTANT_MEMORY_SQL));
  await serverDB.execute(sql.raw(CHAT_GROUP_MEMBERSHIP_OWNERSHIP_SQL));

  console.log('✅ database migration pass.');
  // eslint-disable-next-line unicorn/no-process-exit
  process.exit(0);
};

let connectionString = process.env.DATABASE_URL;

// only migrate database if the connection string is available
if (connectionString) {
  // eslint-disable-next-line unicorn/prefer-top-level-await
  runMigrations().catch((err) => {
    console.error('❌ Database migrate failed:', err);

    const errMsg = err.message as string;

    if (errMsg.includes('extension "vector" is not available')) {
      console.info(PGVECTOR_HINT);
    } else if (errMsg.includes(`Cannot read properties of undefined (reading 'migrate')`)) {
      console.info(DB_FAIL_INIT_HINT);
    }

    // eslint-disable-next-line unicorn/no-process-exit
    process.exit(1);
  });
} else {
  console.log('🟢 database env not found, migration skipped');
}
