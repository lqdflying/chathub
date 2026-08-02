const SKILLS_STORAGE_SQL = `
ALTER TABLE "agents" ADD COLUMN IF NOT EXISTS "skills" jsonb DEFAULT '[]'::jsonb;

CREATE TABLE IF NOT EXISTS "user_installed_skills" (
  "user_id" text NOT NULL REFERENCES "users"("id") ON DELETE cascade,
  "identifier" text NOT NULL,
  "name" text NOT NULL,
  "description" text NOT NULL,
  "instructions" text NOT NULL,
  "source_type" text NOT NULL,
  "source_url" text,
  "source_ref" text,
  "content_hash" text NOT NULL,
  "accessed_at" timestamp with time zone DEFAULT now() NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  PRIMARY KEY ("user_id", "identifier"),
  UNIQUE ("user_id", "content_hash")
);
`;

const ensureSkillsStorage = async (client) => {
  await client.query(SKILLS_STORAGE_SQL);
};

module.exports = { ensureSkillsStorage, SKILLS_STORAGE_SQL };
