ALTER TABLE "conversation_generation_operations" ADD COLUMN IF NOT EXISTS "lane_generation" integer DEFAULT 1 NOT NULL;
--> statement-breakpoint
DROP INDEX IF EXISTS "conversation_generation_operations_lane_active_uniq";
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "conversation_generation_operations_lane_active_uniq" ON "conversation_generation_operations" USING btree ("lane") WHERE "status" in ('pending', 'processing');
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "conversation_generation_operations_pending_no_job_idx" ON "conversation_generation_operations" USING btree ("status") WHERE "status" = 'pending' AND "worker_job_id" IS NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "conversation_generation_operations_stale_processing_idx" ON "conversation_generation_operations" USING btree ("status", "heartbeat_at") WHERE "status" = 'processing';
