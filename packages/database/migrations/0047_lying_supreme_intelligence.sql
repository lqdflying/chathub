ALTER TABLE "topics" ADD COLUMN "last_activity_at" timestamp with time zone;
--> statement-breakpoint
UPDATE "topics" AS "topic"
SET "last_activity_at" = GREATEST(
  COALESCE("topic"."updated_at", "topic"."created_at"),
  COALESCE(
    (
      SELECT MAX("message"."created_at")
      FROM "messages" AS "message"
      WHERE "message"."topic_id" = "topic"."id"
    ),
    "topic"."created_at"
  )
);
--> statement-breakpoint
ALTER TABLE "topics"
  ALTER COLUMN "last_activity_at" SET DEFAULT now(),
  ALTER COLUMN "last_activity_at" SET NOT NULL;