ALTER TABLE "agents" ADD COLUMN IF NOT EXISTS "assistant_memory_meta" jsonb;--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN IF NOT EXISTS "fixed_memory" text;
