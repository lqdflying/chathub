CREATE TABLE IF NOT EXISTS "token_estimation_profiles" (
	"user_id" text NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"estimator_revision" integer NOT NULL,
	"samples" integer DEFAULT 0 NOT NULL,
	"ewma" real NOT NULL,
	"accessed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "token_estimation_profiles_pk" PRIMARY KEY("user_id","provider","model","estimator_revision")
);
--> statement-breakpoint
ALTER TABLE "token_estimation_profiles" ADD CONSTRAINT "token_estimation_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
