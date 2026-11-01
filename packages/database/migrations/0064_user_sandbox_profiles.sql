CREATE TABLE IF NOT EXISTS "user_sandbox_profiles" (
	"user_id" text NOT NULL,
	"profile_id" text NOT NULL,
	"enabled" boolean NOT NULL,
	"accessed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_sandbox_profiles_pk" PRIMARY KEY("user_id","profile_id")
);
--> statement-breakpoint
ALTER TABLE "user_sandbox_profiles" ADD CONSTRAINT "user_sandbox_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
