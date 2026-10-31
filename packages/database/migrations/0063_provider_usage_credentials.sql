CREATE TABLE IF NOT EXISTS "provider_usage_credentials" (
	"user_id" text NOT NULL,
	"provider" text NOT NULL,
	"credential" text NOT NULL,
	"key_hint" varchar(16) NOT NULL,
	"accessed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "provider_usage_credentials_pk" PRIMARY KEY("user_id","provider")
);
--> statement-breakpoint
ALTER TABLE "provider_usage_credentials" ADD CONSTRAINT "provider_usage_credentials_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
