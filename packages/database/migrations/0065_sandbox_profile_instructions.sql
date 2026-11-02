CREATE TABLE IF NOT EXISTS "sandbox_profile_instructions" (
	"profile_id" text PRIMARY KEY NOT NULL,
	"instruction" text NOT NULL,
	"updated_by" text,
	"accessed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sandbox_profile_instructions" ADD CONSTRAINT "sandbox_profile_instructions_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
