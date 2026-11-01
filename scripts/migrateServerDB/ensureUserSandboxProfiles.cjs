/**
 * Idempotent repair for user_sandbox_profiles (matches migration 0064).
 * Safe to run after every migration.
 */
const USER_SANDBOX_PROFILES_SQL = `CREATE TABLE IF NOT EXISTS "user_sandbox_profiles" (
  "user_id" text NOT NULL,
  "profile_id" text NOT NULL,
  "enabled" boolean NOT NULL,
  "accessed_at" timestamp with time zone DEFAULT now() NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "user_sandbox_profiles_pk" PRIMARY KEY("user_id","profile_id")
);

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'user_sandbox_profiles_user_id_users_id_fk'
      AND conrelid = 'public.user_sandbox_profiles'::regclass
  ) THEN
    ALTER TABLE "user_sandbox_profiles"
      ADD CONSTRAINT "user_sandbox_profiles_user_id_users_id_fk"
      FOREIGN KEY ("user_id")
      REFERENCES "public"."users"("id")
      ON DELETE cascade
      ON UPDATE no action;
  END IF;
END $$;`;

/** @param {{ query: (sql: string) => Promise<unknown> }} client node-pg Pool or compatible */
const ensureUserSandboxProfilesTable = async (client) => {
  await client.query(USER_SANDBOX_PROFILES_SQL);
};

module.exports = { USER_SANDBOX_PROFILES_SQL, ensureUserSandboxProfilesTable };
