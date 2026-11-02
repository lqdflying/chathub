/**
 * Idempotent repair for sandbox_profile_instructions (matches migration 0065).
 * Safe to run after every migration.
 */
const SANDBOX_PROFILE_INSTRUCTIONS_SQL = `CREATE TABLE IF NOT EXISTS "sandbox_profile_instructions" (
  "profile_id" text PRIMARY KEY NOT NULL,
  "instruction" text NOT NULL,
  "updated_by" text,
  "accessed_at" timestamp with time zone DEFAULT now() NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'sandbox_profile_instructions_updated_by_users_id_fk'
      AND conrelid = 'public.sandbox_profile_instructions'::regclass
  ) THEN
    ALTER TABLE "sandbox_profile_instructions"
      ADD CONSTRAINT "sandbox_profile_instructions_updated_by_users_id_fk"
      FOREIGN KEY ("updated_by")
      REFERENCES "public"."users"("id")
      ON DELETE set null
      ON UPDATE no action;
  END IF;
END $$;`;

/** @param {{ query: (sql: string) => Promise<unknown> }} client node-pg Pool or compatible */
const ensureSandboxProfileInstructionsTable = async (client) => {
  await client.query(SANDBOX_PROFILE_INSTRUCTIONS_SQL);
};

module.exports = { SANDBOX_PROFILE_INSTRUCTIONS_SQL, ensureSandboxProfileInstructionsTable };
