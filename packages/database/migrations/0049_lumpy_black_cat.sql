DO $$
DECLARE
	membership_table regclass := to_regclass('public.chat_groups_agents');
	agent_table regclass := to_regclass('public.agents');
	group_table regclass := to_regclass('public.chat_groups');
	user_table regclass := to_regclass('public.users');
	membership_agent_columns smallint[];
	membership_group_columns smallint[];
	membership_user_columns smallint[];
	agent_id_columns smallint[];
	agent_owner_columns smallint[];
	group_id_columns smallint[];
	group_owner_columns smallint[];
	user_id_columns smallint[];
	constraint_spec record;
	index_spec record;
BEGIN
	IF membership_table IS NULL
		OR agent_table IS NULL
		OR group_table IS NULL
		OR user_table IS NULL THEN
		RETURN;
	END IF;

	SELECT ARRAY[
		(SELECT attnum FROM pg_attribute WHERE attrelid = membership_table AND attname = 'agent_id'),
		(SELECT attnum FROM pg_attribute WHERE attrelid = membership_table AND attname = 'user_id')
	]::smallint[] INTO membership_agent_columns;
	SELECT ARRAY[
		(SELECT attnum FROM pg_attribute WHERE attrelid = membership_table AND attname = 'chat_group_id'),
		(SELECT attnum FROM pg_attribute WHERE attrelid = membership_table AND attname = 'user_id')
	]::smallint[] INTO membership_group_columns;
	SELECT ARRAY[
		(SELECT attnum FROM pg_attribute WHERE attrelid = membership_table AND attname = 'user_id')
	]::smallint[] INTO membership_user_columns;
	SELECT ARRAY[
		(SELECT attnum FROM pg_attribute WHERE attrelid = agent_table AND attname = 'id')
	]::smallint[] INTO agent_id_columns;
	SELECT ARRAY[
		(SELECT attnum FROM pg_attribute WHERE attrelid = agent_table AND attname = 'id'),
		(SELECT attnum FROM pg_attribute WHERE attrelid = agent_table AND attname = 'user_id')
	]::smallint[] INTO agent_owner_columns;
	SELECT ARRAY[
		(SELECT attnum FROM pg_attribute WHERE attrelid = group_table AND attname = 'id')
	]::smallint[] INTO group_id_columns;
	SELECT ARRAY[
		(SELECT attnum FROM pg_attribute WHERE attrelid = group_table AND attname = 'id'),
		(SELECT attnum FROM pg_attribute WHERE attrelid = group_table AND attname = 'user_id')
	]::smallint[] INTO group_owner_columns;
	SELECT ARRAY[
		(SELECT attnum FROM pg_attribute WHERE attrelid = user_table AND attname = 'id')
	]::smallint[] INTO user_id_columns;

	IF array_position(membership_agent_columns, NULL) IS NOT NULL
		OR array_position(membership_group_columns, NULL) IS NOT NULL
		OR array_position(membership_user_columns, NULL) IS NOT NULL
		OR array_position(agent_id_columns, NULL) IS NOT NULL
		OR array_position(agent_owner_columns, NULL) IS NOT NULL
		OR array_position(group_id_columns, NULL) IS NOT NULL
		OR array_position(group_owner_columns, NULL) IS NOT NULL
		OR array_position(user_id_columns, NULL) IS NOT NULL THEN
		RETURN;
	END IF;

	UPDATE "chat_groups_agents" AS membership
	SET "user_id" = chat_group."user_id"
	FROM "chat_groups" AS chat_group, "agents" AS agent
	WHERE membership."chat_group_id" = chat_group."id"
		AND membership."agent_id" = agent."id"
		AND chat_group."user_id" = agent."user_id"
		AND membership."user_id" IS DISTINCT FROM chat_group."user_id";

	DELETE FROM "chat_groups_agents" AS membership
	WHERE NOT EXISTS (
			SELECT 1
			FROM "chat_groups" AS chat_group
			WHERE chat_group."id" = membership."chat_group_id"
				AND chat_group."user_id" = membership."user_id"
		)
		OR NOT EXISTS (
			SELECT 1
			FROM "agents" AS agent
			WHERE agent."id" = membership."agent_id"
				AND agent."user_id" = membership."user_id"
		)
		OR NOT EXISTS (
			SELECT 1
			FROM "users" AS owner
			WHERE owner."id" = membership."user_id"
		);

	FOR constraint_spec IN
		SELECT *
		FROM (
			VALUES
				(
					'chat_groups_agents_chat_group_id_chat_groups_id_fk',
					group_table,
					ARRAY[membership_group_columns[1]]::smallint[],
					group_id_columns,
					'ALTER TABLE "chat_groups_agents" ADD CONSTRAINT "chat_groups_agents_chat_group_id_chat_groups_id_fk" FOREIGN KEY ("chat_group_id") REFERENCES "public"."chat_groups"("id") ON DELETE cascade ON UPDATE no action'
				),
				(
					'chat_groups_agents_agent_id_agents_id_fk',
					agent_table,
					ARRAY[membership_agent_columns[1]]::smallint[],
					agent_id_columns,
					'ALTER TABLE "chat_groups_agents" ADD CONSTRAINT "chat_groups_agents_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action'
				),
				(
					'chat_groups_agents_user_id_users_id_fk',
					user_table,
					membership_user_columns,
					user_id_columns,
					'ALTER TABLE "chat_groups_agents" ADD CONSTRAINT "chat_groups_agents_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action'
				),
				(
					'chat_groups_agents_agent_id_user_id_agents_id_user_id_fk',
					agent_table,
					membership_agent_columns,
					agent_owner_columns,
					'ALTER TABLE "chat_groups_agents" ADD CONSTRAINT "chat_groups_agents_agent_id_user_id_agents_id_user_id_fk" FOREIGN KEY ("agent_id", "user_id") REFERENCES "public"."agents"("id", "user_id") ON DELETE cascade ON UPDATE no action'
				),
				(
					'chat_groups_agents_group_id_user_id_chat_groups_id_user_id_fk',
					group_table,
					membership_group_columns,
					group_owner_columns,
					'ALTER TABLE "chat_groups_agents" ADD CONSTRAINT "chat_groups_agents_group_id_user_id_chat_groups_id_user_id_fk" FOREIGN KEY ("chat_group_id", "user_id") REFERENCES "public"."chat_groups"("id", "user_id") ON DELETE cascade ON UPDATE no action'
				)
		) AS desired(name, referenced_table, child_columns, parent_columns, definition)
	LOOP
		IF EXISTS (
			SELECT 1
			FROM pg_constraint AS actual
			WHERE actual.conname = constraint_spec.name
				AND actual.conrelid = membership_table
				AND NOT (
					actual.contype = 'f'
					AND actual.confrelid = constraint_spec.referenced_table
					AND array_to_string(actual.conkey, ',') = array_to_string(constraint_spec.child_columns, ',')
					AND array_to_string(actual.confkey, ',') = array_to_string(constraint_spec.parent_columns, ',')
					AND actual.confdeltype = 'c'
					AND actual.confupdtype = 'a'
				)
		) THEN
			EXECUTE format(
				'ALTER TABLE "chat_groups_agents" DROP CONSTRAINT %I',
				constraint_spec.name
			);
		END IF;
	END LOOP;

	FOR index_spec IN
		SELECT *
		FROM (
			VALUES
				(
					'agents_id_user_id_unique',
					agent_table,
					agent_owner_columns,
					'CREATE UNIQUE INDEX "agents_id_user_id_unique" ON "agents" USING btree ("id", "user_id")'
				),
				(
					'chat_groups_id_user_id_unique',
					group_table,
					group_owner_columns,
					'CREATE UNIQUE INDEX "chat_groups_id_user_id_unique" ON "chat_groups" USING btree ("id", "user_id")'
				)
		) AS desired(name, indexed_table, indexed_columns, definition)
	LOOP
		IF to_regclass('public.' || index_spec.name) IS NOT NULL
			AND NOT EXISTS (
				SELECT 1
				FROM pg_index AS actual
				WHERE actual.indexrelid = to_regclass('public.' || index_spec.name)
					AND actual.indrelid = index_spec.indexed_table
					AND actual.indisunique
					AND actual.indisvalid
					AND actual.indisready
					AND actual.indpred IS NULL
					AND actual.indexprs IS NULL
					AND actual.indnkeyatts = cardinality(index_spec.indexed_columns)
					AND actual.indnatts = cardinality(index_spec.indexed_columns)
					AND array_to_string(actual.indkey::smallint[], ',') =
						array_to_string(index_spec.indexed_columns, ',')
			) THEN
			EXECUTE format('DROP INDEX %I', index_spec.name);
		END IF;

		IF to_regclass('public.' || index_spec.name) IS NULL THEN
			EXECUTE index_spec.definition;
		END IF;
	END LOOP;

	FOR constraint_spec IN
		SELECT *
		FROM (
			VALUES
				(
					'chat_groups_agents_chat_group_id_chat_groups_id_fk',
					group_table,
					ARRAY[membership_group_columns[1]]::smallint[],
					group_id_columns,
					'ALTER TABLE "chat_groups_agents" ADD CONSTRAINT "chat_groups_agents_chat_group_id_chat_groups_id_fk" FOREIGN KEY ("chat_group_id") REFERENCES "public"."chat_groups"("id") ON DELETE cascade ON UPDATE no action'
				),
				(
					'chat_groups_agents_agent_id_agents_id_fk',
					agent_table,
					ARRAY[membership_agent_columns[1]]::smallint[],
					agent_id_columns,
					'ALTER TABLE "chat_groups_agents" ADD CONSTRAINT "chat_groups_agents_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action'
				),
				(
					'chat_groups_agents_user_id_users_id_fk',
					user_table,
					membership_user_columns,
					user_id_columns,
					'ALTER TABLE "chat_groups_agents" ADD CONSTRAINT "chat_groups_agents_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action'
				),
				(
					'chat_groups_agents_agent_id_user_id_agents_id_user_id_fk',
					agent_table,
					membership_agent_columns,
					agent_owner_columns,
					'ALTER TABLE "chat_groups_agents" ADD CONSTRAINT "chat_groups_agents_agent_id_user_id_agents_id_user_id_fk" FOREIGN KEY ("agent_id", "user_id") REFERENCES "public"."agents"("id", "user_id") ON DELETE cascade ON UPDATE no action'
				),
				(
					'chat_groups_agents_group_id_user_id_chat_groups_id_user_id_fk',
					group_table,
					membership_group_columns,
					group_owner_columns,
					'ALTER TABLE "chat_groups_agents" ADD CONSTRAINT "chat_groups_agents_group_id_user_id_chat_groups_id_user_id_fk" FOREIGN KEY ("chat_group_id", "user_id") REFERENCES "public"."chat_groups"("id", "user_id") ON DELETE cascade ON UPDATE no action'
				)
		) AS desired(name, referenced_table, child_columns, parent_columns, definition)
	LOOP
		IF NOT EXISTS (
			SELECT 1
			FROM pg_constraint AS actual
			WHERE actual.conname = constraint_spec.name
				AND actual.conrelid = membership_table
				AND actual.contype = 'f'
				AND actual.confrelid = constraint_spec.referenced_table
				AND array_to_string(actual.conkey, ',') = array_to_string(constraint_spec.child_columns, ',')
				AND array_to_string(actual.confkey, ',') = array_to_string(constraint_spec.parent_columns, ',')
				AND actual.confdeltype = 'c'
				AND actual.confupdtype = 'a'
		) THEN
			EXECUTE constraint_spec.definition;
		END IF;

		EXECUTE format(
			'ALTER TABLE "chat_groups_agents" VALIDATE CONSTRAINT %I',
			constraint_spec.name
		);
	END LOOP;
END $$;