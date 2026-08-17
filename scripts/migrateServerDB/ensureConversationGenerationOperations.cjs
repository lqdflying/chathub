/**
 * Idempotent repair for durable conversation generation tables.
 * Safe to run after every migration (matches 0054_add_conversation_generation.sql).
 */
const CONVERSATION_GENERATION_SQL = `
CREATE TABLE IF NOT EXISTS "conversation_generation_operations" (
  "id" text PRIMARY KEY NOT NULL,
  "user_id" text NOT NULL,
  "kind" varchar(255) NOT NULL,
  "status" varchar(255) DEFAULT 'pending' NOT NULL,
  "phase" varchar(255),
  "lane" text NOT NULL,
  "session_id" text,
  "topic_id" text,
  "thread_id" text,
  "group_id" text,
  "agent_id" text,
  "user_message_id" text,
  "assistant_message_id" text,
  "parent_message_id" text,
  "idempotency_key" varchar(255),
  "config" jsonb NOT NULL,
  "error" jsonb,
  "revision" integer DEFAULT 0 NOT NULL,
  "attempt" integer DEFAULT 0 NOT NULL,
  "lane_generation" integer DEFAULT 1 NOT NULL,
  "conversation_version" integer,
  "worker_job_id" text,
  "heartbeat_at" timestamp with time zone,
  "started_at" timestamp with time zone,
  "finished_at" timestamp with time zone,
  "cancel_requested_at" timestamp with time zone,
  "accessed_at" timestamp with time zone DEFAULT now() NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "conversation_generation_steps" (
  "id" text PRIMARY KEY NOT NULL,
  "operation_id" text NOT NULL,
  "user_id" text NOT NULL,
  "kind" varchar(255) NOT NULL,
  "status" varchar(255) NOT NULL,
  "attempt" integer DEFAULT 0 NOT NULL,
  "input_hash" text,
  "result" jsonb,
  "error" jsonb,
  "started_at" timestamp with time zone,
  "finished_at" timestamp with time zone,
  "accessed_at" timestamp with time zone DEFAULT now() NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "conversation_generation_events" (
  "id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  "operation_id" text NOT NULL,
  "user_id" text NOT NULL,
  "type" varchar(255) NOT NULL,
  "revision" integer NOT NULL,
  "payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

DO $$ BEGIN
  ALTER TABLE "conversation_generation_operations"
    ADD CONSTRAINT "conversation_generation_operations_user_id_users_id_fk"
    FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "conversation_generation_steps"
    ADD CONSTRAINT "conversation_generation_steps_operation_id_conversation_generation_operations_id_fk"
    FOREIGN KEY ("operation_id") REFERENCES "public"."conversation_generation_operations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "conversation_generation_steps"
    ADD CONSTRAINT "conversation_generation_steps_user_id_users_id_fk"
    FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "conversation_generation_events"
    ADD CONSTRAINT "conversation_generation_events_operation_id_conversation_generation_operations_id_fk"
    FOREIGN KEY ("operation_id") REFERENCES "public"."conversation_generation_operations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "conversation_generation_events"
    ADD CONSTRAINT "conversation_generation_events_user_id_users_id_fk"
    FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "conversation_generation_operations"
    ADD COLUMN IF NOT EXISTS "lane_generation" integer DEFAULT 1 NOT NULL;
EXCEPTION
  WHEN duplicate_column THEN null;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "conversation_generation_operations_lane_active_uniq"
  ON "conversation_generation_operations" USING btree ("lane")
  WHERE "status" in ('pending', 'processing');

CREATE INDEX IF NOT EXISTS "conversation_generation_operations_pending_no_job_idx"
  ON "conversation_generation_operations" USING btree ("status")
  WHERE "status" = 'pending' AND "worker_job_id" IS NULL;

CREATE INDEX IF NOT EXISTS "conversation_generation_operations_stale_processing_idx"
  ON "conversation_generation_operations" USING btree ("status", "heartbeat_at")
  WHERE "status" = 'processing';

CREATE UNIQUE INDEX IF NOT EXISTS "conversation_generation_operations_idempotency_uniq"
  ON "conversation_generation_operations" USING btree ("user_id","idempotency_key")
  WHERE "idempotency_key" is not null;

CREATE INDEX IF NOT EXISTS "conversation_generation_operations_user_created_idx"
  ON "conversation_generation_operations" USING btree ("user_id","created_at");

CREATE INDEX IF NOT EXISTS "conversation_generation_operations_user_status_idx"
  ON "conversation_generation_operations" USING btree ("user_id","status");

CREATE INDEX IF NOT EXISTS "conversation_generation_steps_operation_idx"
  ON "conversation_generation_steps" USING btree ("operation_id","created_at");

CREATE INDEX IF NOT EXISTS "conversation_generation_steps_input_hash_idx"
  ON "conversation_generation_steps" USING btree ("operation_id","input_hash");

CREATE INDEX IF NOT EXISTS "conversation_generation_events_user_id_idx"
  ON "conversation_generation_events" USING btree ("user_id","id");

CREATE INDEX IF NOT EXISTS "conversation_generation_events_operation_idx"
  ON "conversation_generation_events" USING btree ("operation_id","id");
`;

/** @param {{ query: (sql: string) => Promise<unknown> }} client node-pg Pool or compatible */
const ensureConversationGenerationOperations = async (client) => {
  await client.query(CONVERSATION_GENERATION_SQL);
};

module.exports = {
  CONVERSATION_GENERATION_SQL,
  ensureConversationGenerationOperations,
};
