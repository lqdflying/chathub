CREATE TABLE IF NOT EXISTS "sandbox_profile_envs" (
	"id" text PRIMARY KEY NOT NULL,
	"profile_id" text NOT NULL,
	"user_id" text,
	"name" text NOT NULL,
	"value" text NOT NULL,
	"hint" text,
	"updated_by" text,
	"accessed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sandbox_profile_envs" ADD CONSTRAINT "sandbox_profile_envs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "sandbox_profile_envs" ADD CONSTRAINT "sandbox_profile_envs_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "sandbox_profile_envs_shared_uniq" ON "sandbox_profile_envs" USING btree ("profile_id","name") WHERE "user_id" is null;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "sandbox_profile_envs_user_uniq" ON "sandbox_profile_envs" USING btree ("profile_id","user_id","name") WHERE "user_id" is not null;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sandbox_profile_envs_user_idx" ON "sandbox_profile_envs" USING btree ("user_id");
