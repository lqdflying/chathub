DO $$ BEGIN
  IF to_regclass('public.conversation_generation_operations_lane_active_uniq') IS NOT NULL
    AND NOT EXISTS (
      SELECT 1
      FROM pg_index index_data
      WHERE index_data.indexrelid =
          to_regclass('public.conversation_generation_operations_lane_active_uniq')
        AND index_data.indrelid = to_regclass('public.conversation_generation_operations')
        AND index_data.indisunique
        AND index_data.indisvalid
        AND index_data.indisready
        AND index_data.indpred IS NOT NULL
        AND index_data.indexprs IS NULL
        AND index_data.indnkeyatts = 1
        AND index_data.indnatts = 1
        AND array_to_string(index_data.indkey::smallint[], ',') = (
          SELECT attribute.attnum::text
          FROM pg_attribute attribute
          WHERE attribute.attrelid = to_regclass('public.conversation_generation_operations')
            AND attribute.attname = 'lane'
            AND NOT attribute.attisdropped
        )
        AND position(
          'pending' in pg_get_expr(index_data.indpred, index_data.indrelid)
        ) > 0
        AND position(
          'processing' in pg_get_expr(index_data.indpred, index_data.indrelid)
        ) > 0
        AND position(
          'cancelling' in pg_get_expr(index_data.indpred, index_data.indrelid)
        ) = 0
        AND position(
          'cancelled' in pg_get_expr(index_data.indpred, index_data.indrelid)
        ) = 0
        AND position(
          'succeeded' in pg_get_expr(index_data.indpred, index_data.indrelid)
        ) = 0
        AND position(
          'failed' in pg_get_expr(index_data.indpred, index_data.indrelid)
        ) = 0
        AND position(
          'interrupted' in pg_get_expr(index_data.indpred, index_data.indrelid)
        ) = 0
    )
  THEN
    DROP INDEX IF EXISTS "conversation_generation_operations_lane_active_uniq";
  END IF;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "conversation_generation_operations_lane_active_uniq"
  ON "conversation_generation_operations" USING btree ("lane")
  WHERE "status" in ('pending', 'processing');
--> statement-breakpoint
DROP INDEX IF EXISTS "conversation_generation_steps_input_hash_idx";
--> statement-breakpoint
DO $$ BEGIN
  IF to_regclass('public.conversation_generation_steps_input_hash_uniq') IS NOT NULL
    AND NOT EXISTS (
      SELECT 1
      FROM pg_index index_data
      WHERE index_data.indexrelid =
          to_regclass('public.conversation_generation_steps_input_hash_uniq')
        AND index_data.indrelid = to_regclass('public.conversation_generation_steps')
        AND index_data.indisunique
        AND index_data.indisvalid
        AND index_data.indisready
        AND index_data.indpred IS NULL
        AND index_data.indexprs IS NULL
        AND index_data.indnkeyatts = 2
        AND index_data.indnatts = 2
        AND array_to_string(index_data.indkey::smallint[], ',') = array_to_string(
          ARRAY[
            (
              SELECT attribute.attnum
              FROM pg_attribute attribute
              WHERE attribute.attrelid = to_regclass('public.conversation_generation_steps')
                AND attribute.attname = 'operation_id'
                AND NOT attribute.attisdropped
            ),
            (
              SELECT attribute.attnum
              FROM pg_attribute attribute
              WHERE attribute.attrelid = to_regclass('public.conversation_generation_steps')
                AND attribute.attname = 'input_hash'
                AND NOT attribute.attisdropped
            )
          ],
          ','
        )
    )
  THEN
    DROP INDEX IF EXISTS "conversation_generation_steps_input_hash_uniq";
  END IF;

  IF to_regclass('public.conversation_generation_steps_input_hash_uniq') IS NULL THEN
    WITH ranked_steps AS (
      SELECT
        "id",
        row_number() OVER (
          PARTITION BY "operation_id", "input_hash"
          ORDER BY
            CASE "status"
              WHEN 'succeeded' THEN 0
              WHEN 'processing' THEN 1
              ELSE 2
            END,
            "updated_at" DESC,
            "id" DESC
        ) AS duplicate_rank
      FROM "conversation_generation_steps"
      WHERE "input_hash" IS NOT NULL
    )
    DELETE FROM "conversation_generation_steps"
    WHERE "id" IN (
      SELECT "id" FROM ranked_steps WHERE duplicate_rank > 1
    );
  END IF;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "conversation_generation_steps_input_hash_uniq"
  ON "conversation_generation_steps" USING btree ("operation_id", "input_hash");
