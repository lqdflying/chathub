/**
 * Idempotent repair: some deployments reported missing `agents.assistant_memory`
 * after DB resets when the migration journal and image drifted or migrator skipped a step.
 * Safe to run after every migration (matches 0043_add_agent_assistant_memory.sql).
 */
const AGENT_ASSISTANT_MEMORY_SQL =
  'ALTER TABLE "agents" ADD COLUMN IF NOT EXISTS "assistant_memory" text';

/** @param {{ query: (sql: string) => Promise<unknown> }} client node-pg Pool or compatible */
const ensureAgentAssistantMemoryColumn = async (client) => {
  await client.query(AGENT_ASSISTANT_MEMORY_SQL);
};

module.exports = { AGENT_ASSISTANT_MEMORY_SQL, ensureAgentAssistantMemoryColumn };
