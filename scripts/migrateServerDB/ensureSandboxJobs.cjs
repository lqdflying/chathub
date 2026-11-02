/**
 * Idempotent repair for sandbox_jobs (matches migration 0066).
 * Safe to run after every migration.
 */
const SANDBOX_JOBS_SQL = `CREATE TABLE IF NOT EXISTS "sandbox_jobs" (
  "id" text PRIMARY KEY NOT NULL,
  "user_id" text NOT NULL,
  "profile_id" text NOT NULL,
  "session_key" text NOT NULL,
  "command_id" text NOT NULL,
  "command" text NOT NULL,
  "cwd" text,
  "output_dir" text,
  "status" text NOT NULL,
  "exit_code" integer,
  "error" text,
  "output_tail" text,
  "files" jsonb,
  "started_at" timestamp with time zone DEFAULT now() NOT NULL,
  "deadline_at" timestamp with time zone NOT NULL,
  "finished_at" timestamp with time zone,
  "last_checked_at" timestamp with time zone,
  "accessed_at" timestamp with time zone DEFAULT now() NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'sandbox_jobs_user_id_users_id_fk'
      AND conrelid = 'public.sandbox_jobs'::regclass
  ) THEN
    ALTER TABLE "sandbox_jobs"
      ADD CONSTRAINT "sandbox_jobs_user_id_users_id_fk"
      FOREIGN KEY ("user_id")
      REFERENCES "public"."users"("id")
      ON DELETE cascade
      ON UPDATE no action;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "sandbox_jobs_user_session_idx"
  ON "sandbox_jobs" USING btree ("user_id","session_key","started_at");
CREATE INDEX IF NOT EXISTS "sandbox_jobs_user_status_idx"
  ON "sandbox_jobs" USING btree ("user_id","status");`;

/** @param {{ query: (sql: string) => Promise<unknown> }} client node-pg Pool or compatible */
const ensureSandboxJobsTable = async (client) => {
  await client.query(SANDBOX_JOBS_SQL);
};

module.exports = { SANDBOX_JOBS_SQL, ensureSandboxJobsTable };
