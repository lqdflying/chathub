CREATE INDEX IF NOT EXISTS "embeddings_user_id_model_idx" ON "embeddings" USING btree ("user_id","model");
CREATE INDEX IF NOT EXISTS "embeddings_vector_hnsw_idx" ON "embeddings" USING hnsw ("embeddings" vector_cosine_ops) WHERE "chunk_id" IS NOT NULL;
