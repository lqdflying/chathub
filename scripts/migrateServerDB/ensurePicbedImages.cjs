/**
 * Idempotent repair for deployments where the migration journal advanced
 * without creating the picbed_images table.
 */
const PICBED_IMAGES_SQL = `
CREATE TABLE IF NOT EXISTS "picbed_images" (
  "id" text PRIMARY KEY NOT NULL,
  "user_id" text NOT NULL,
  "url" text NOT NULL,
  "name" text NOT NULL,
  "size" integer NOT NULL,
  "file_type" varchar(255) NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

DO $$ BEGIN
  ALTER TABLE "picbed_images"
    ADD CONSTRAINT "picbed_images_user_id_users_id_fk"
    FOREIGN KEY ("user_id")
    REFERENCES "public"."users"("id")
    ON DELETE cascade
    ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

CREATE INDEX IF NOT EXISTS "picbed_images_user_id_idx"
  ON "picbed_images" USING btree ("user_id");
`;

/** @param {{ query: (sql: string) => Promise<unknown> }} client node-pg Pool or compatible */
const ensurePicbedImagesTable = async (client) => {
  await client.query(PICBED_IMAGES_SQL);
};

module.exports = { PICBED_IMAGES_SQL, ensurePicbedImagesTable };
