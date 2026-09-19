ALTER TABLE "openai_codex_oauth_tokens" ADD COLUMN IF NOT EXISTS "refresh_lock_id" varchar(256);--> statement-breakpoint
ALTER TABLE "openai_codex_oauth_tokens" ADD COLUMN IF NOT EXISTS "refresh_lock_until" timestamp with time zone;
