/**
 * Idempotent repair for sandbox_profile_files (matches migration 0071).
 * Safe to run after every migration.
 */
const SANDBOX_PROFILE_FILES_SQL = `CREATE TABLE IF NOT EXISTS "sandbox_profile_files" (
  "id" text PRIMARY KEY NOT NULL,
  "profile_id" text NOT NULL,
  "user_id" text,
  "path" text NOT NULL,
  "mode" integer NOT NULL,
  "content" text NOT NULL,
  "size" integer NOT NULL,
  "sensitive" boolean DEFAULT true NOT NULL,
  "updated_by" text,
  "accessed_at" timestamp with time zone DEFAULT now() NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'sandbox_profile_files_user_id_users_id_fk'
      AND conrelid = 'public.sandbox_profile_files'::regclass
  ) THEN
    ALTER TABLE "sandbox_profile_files"
      ADD CONSTRAINT "sandbox_profile_files_user_id_users_id_fk"
      FOREIGN KEY ("user_id") REFERENCES "public"."users"("id")
      ON DELETE cascade ON UPDATE no action;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'sandbox_profile_files_updated_by_users_id_fk'
      AND conrelid = 'public.sandbox_profile_files'::regclass
  ) THEN
    ALTER TABLE "sandbox_profile_files"
      ADD CONSTRAINT "sandbox_profile_files_updated_by_users_id_fk"
      FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id")
      ON DELETE set null ON UPDATE no action;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "sandbox_profile_files_shared_uniq"
  ON "sandbox_profile_files" USING btree ("profile_id","path") WHERE "user_id" is null;
CREATE UNIQUE INDEX IF NOT EXISTS "sandbox_profile_files_user_uniq"
  ON "sandbox_profile_files" USING btree ("profile_id","user_id","path") WHERE "user_id" is not null;
CREATE INDEX IF NOT EXISTS "sandbox_profile_files_user_idx"
  ON "sandbox_profile_files" USING btree ("user_id");`;

/** @param {{ query: (sql: string) => Promise<unknown> }} client node-pg Pool or compatible */
const ensureSandboxProfileFilesTable = async (client) => {
  await client.query(SANDBOX_PROFILE_FILES_SQL);
};

module.exports = { SANDBOX_PROFILE_FILES_SQL, ensureSandboxProfileFilesTable };
