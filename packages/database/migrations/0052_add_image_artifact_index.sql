CREATE INDEX IF NOT EXISTS "files_user_source_created_at_id_idx" ON "files" USING btree ("user_id","source","created_at","id");
