ALTER TABLE "agents" ADD COLUMN IF NOT EXISTS "skills" jsonb DEFAULT '[]'::jsonb;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "user_installed_skills" (
	"user_id" text NOT NULL,
	"identifier" text NOT NULL,
	"name" text NOT NULL,
	"description" text NOT NULL,
	"instructions" text NOT NULL,
	"source_type" text NOT NULL,
	"source_url" text,
	"source_ref" text,
	"content_hash" text NOT NULL,
	"accessed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_installed_skills_user_id_identifier_pk" PRIMARY KEY("user_id","identifier"),
	CONSTRAINT "user_installed_skills_user_hash_unique" UNIQUE("user_id","content_hash")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "user_installed_skills" ADD CONSTRAINT "user_installed_skills_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
