/**
 * Idempotent repair for sandbox_hub_profiles (matches migration 0067).
 * Safe to run after every migration.
 */
const SANDBOX_HUB_PROFILES_SQL = `CREATE TABLE IF NOT EXISTS "sandbox_hub_profiles" (
  "id" text PRIMARY KEY NOT NULL,
  "position" integer DEFAULT 0 NOT NULL,
  "name" text NOT NULL,
  "description" text NOT NULL,
  "avatar" text,
  "server_id" text NOT NULL,
  "image" text,
  "cpu" text,
  "memory" text,
  "egress" jsonb,
  "ready_timeout_ms" bigint,
  "session_idle_timeout_ms" bigint,
  "session_max_lifetime_ms" bigint,
  "job_max_runtime_ms" bigint,
  "default_enabled" boolean DEFAULT false NOT NULL,
  "instruction_base" text DEFAULT 'general' NOT NULL,
  "instruction_text" text,
  "image_status" text DEFAULT 'unknown' NOT NULL,
  "image_status_message" text,
  "image_checked_ref" text,
  "image_checked_at" timestamp with time zone,
  "updated_by" text,
  "accessed_at" timestamp with time zone DEFAULT now() NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'sandbox_hub_profiles_updated_by_users_id_fk'
      AND conrelid = 'public.sandbox_hub_profiles'::regclass
  ) THEN
    ALTER TABLE "sandbox_hub_profiles"
      ADD CONSTRAINT "sandbox_hub_profiles_updated_by_users_id_fk"
      FOREIGN KEY ("updated_by")
      REFERENCES "public"."users"("id")
      ON DELETE set null
      ON UPDATE no action;
  END IF;
END $$;`;

/** @param {{ query: (sql: string) => Promise<unknown> }} client node-pg Pool or compatible */
const ensureSandboxHubProfilesTable = async (client) => {
  await client.query(SANDBOX_HUB_PROFILES_SQL);
};

module.exports = { SANDBOX_HUB_PROFILES_SQL, ensureSandboxHubProfilesTable };
