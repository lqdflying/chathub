ALTER TABLE "conversation_generation_operations" ADD COLUMN IF NOT EXISTS "placeholders_cleaned_at" timestamp with time zone;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "conversation_generation_operations_placeholder_cleanup_idx"
  ON "conversation_generation_operations" USING btree ("finished_at", "id")
  WHERE "placeholders_cleaned_at" IS NULL
    AND "finished_at" IS NOT NULL
    AND "status" IN ('cancelled', 'failed', 'interrupted', 'succeeded');
