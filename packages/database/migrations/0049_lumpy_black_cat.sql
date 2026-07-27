DO $$ BEGIN
	IF to_regclass('public.chat_groups_agents') IS NULL
		OR to_regclass('public.chat_groups') IS NULL
		OR to_regclass('public.agents') IS NULL THEN
		RETURN;
	END IF;

	UPDATE "chat_groups_agents" AS membership
	SET "user_id" = chat_group."user_id"
	FROM "chat_groups" AS chat_group, "agents" AS agent
	WHERE membership."chat_group_id" = chat_group."id"
		AND membership."agent_id" = agent."id"
		AND chat_group."user_id" = agent."user_id"
		AND membership."user_id" <> chat_group."user_id";

	DELETE FROM "chat_groups_agents" AS membership
	USING "chat_groups" AS chat_group, "agents" AS agent
	WHERE membership."chat_group_id" = chat_group."id"
		AND membership."agent_id" = agent."id"
		AND chat_group."user_id" <> agent."user_id";

	CREATE UNIQUE INDEX IF NOT EXISTS "agents_id_user_id_unique"
		ON "agents" USING btree ("id", "user_id");
	CREATE UNIQUE INDEX IF NOT EXISTS "chat_groups_id_user_id_unique"
		ON "chat_groups" USING btree ("id", "user_id");

	IF NOT EXISTS (
		SELECT 1
		FROM pg_constraint
		WHERE conname = 'chat_groups_agents_agent_id_user_id_agents_id_user_id_fk'
			AND conrelid = 'public.chat_groups_agents'::regclass
	) THEN
		ALTER TABLE "chat_groups_agents"
			ADD CONSTRAINT "chat_groups_agents_agent_id_user_id_agents_id_user_id_fk"
			FOREIGN KEY ("agent_id", "user_id")
			REFERENCES "public"."agents"("id", "user_id")
			ON DELETE no action
			ON UPDATE no action;
	END IF;

	IF NOT EXISTS (
		SELECT 1
		FROM pg_constraint
		WHERE conname = 'chat_groups_agents_group_id_user_id_chat_groups_id_user_id_fk'
			AND conrelid = 'public.chat_groups_agents'::regclass
	) THEN
		ALTER TABLE "chat_groups_agents"
			ADD CONSTRAINT "chat_groups_agents_group_id_user_id_chat_groups_id_user_id_fk"
			FOREIGN KEY ("chat_group_id", "user_id")
			REFERENCES "public"."chat_groups"("id", "user_id")
			ON DELETE no action
			ON UPDATE no action;
	END IF;
END $$;