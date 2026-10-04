-- The Code Interpreter builtin tool became the Sandbox tool. Rewrite the
-- stored plugin lists in place: keep their order, and keep one entry when a
-- list already holds both identifiers. Tool messages keep the old identifier;
-- the app reads it as an alias.
UPDATE "agents"
SET "plugins" = (
	SELECT COALESCE(jsonb_agg("kept"."value" ORDER BY "kept"."position"), '[]'::jsonb)
	FROM (
		SELECT DISTINCT ON ("mapped"."value") "mapped"."value", "mapped"."position"
		FROM (
			SELECT
				CASE WHEN "list"."element" = '"lobe-code-interpreter"'::jsonb THEN '"lobe-sandbox"'::jsonb ELSE "list"."element" END AS "value",
				"list"."position"
			FROM jsonb_array_elements("agents"."plugins") WITH ORDINALITY AS "list"("element", "position")
		) AS "mapped"
		ORDER BY "mapped"."value", "mapped"."position"
	) AS "kept"
)
WHERE jsonb_typeof("plugins") = 'array' AND "plugins" ? 'lobe-code-interpreter';
--> statement-breakpoint
UPDATE "user_settings"
SET "default_agent" = jsonb_set(
	"default_agent",
	'{config,plugins}',
	(
		SELECT COALESCE(jsonb_agg("kept"."value" ORDER BY "kept"."position"), '[]'::jsonb)
		FROM (
			SELECT DISTINCT ON ("mapped"."value") "mapped"."value", "mapped"."position"
			FROM (
				SELECT
					CASE WHEN "list"."element" = '"lobe-code-interpreter"'::jsonb THEN '"lobe-sandbox"'::jsonb ELSE "list"."element" END AS "value",
					"list"."position"
				FROM jsonb_array_elements("user_settings"."default_agent" #> '{config,plugins}') WITH ORDINALITY AS "list"("element", "position")
			) AS "mapped"
			ORDER BY "mapped"."value", "mapped"."position"
		) AS "kept"
	)
)
WHERE jsonb_typeof("default_agent" #> '{config,plugins}') = 'array'
	AND ("default_agent" #> '{config,plugins}') ? 'lobe-code-interpreter';
