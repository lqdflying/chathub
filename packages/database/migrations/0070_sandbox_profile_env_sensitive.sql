ALTER TABLE "sandbox_profile_envs" ADD COLUMN IF NOT EXISTS "sensitive" boolean DEFAULT true NOT NULL;
