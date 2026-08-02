import { isSkillName } from '@lobechat/types';
import { ssrfSafeFetch } from 'ssrf-safe-fetch';
import { z } from 'zod';

import { SkillModel } from '@/database/models/skill';
import { appEnv } from '@/envs/app';
import { authedProcedure, router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import {
  MAX_SKILL_BYTES,
  assertExpectedSkillIdentifier,
  parseSkill,
  resolveSkillSource,
} from '@/services/skill/parser';
import { parseSkillRegistry } from '@/services/skill/registry';

const skillProcedure = authedProcedure
  .use(serverDatabase)
  .use(async (opts) =>
    opts.next({ ctx: { skillModel: new SkillModel(opts.ctx.serverDB, opts.ctx.userId) } }),
  );

const sourceTypeSchema = z.enum(['github', 'registry', 'url']);

const installInputSchema = z.object({
  description: z.string().max(1024).optional(),
  identifier: z.string().max(64).refine(isSkillName).optional(),
  instructions: z.string().max(MAX_SKILL_BYTES),
  name: z.string().max(64).refine(isSkillName).optional(),
  sourceRef: z.string().max(255).optional(),
  sourceType: sourceTypeSchema,
  sourceUrl: z.string().url().optional(),
});

const persistSkill = async (
  model: SkillModel,
  input: z.infer<typeof installInputSchema>,
  expectedIdentifier?: string,
) => {
  const parsed = parseSkill(input.instructions);
  assertExpectedSkillIdentifier(parsed.name, expectedIdentifier);

  const identifier = input.identifier || parsed.name;
  const source = input.sourceUrl
    ? resolveSkillSource(input.sourceUrl, input.sourceType, input.sourceRef)
    : undefined;

  await model.create({
    contentHash: parsed.contentHash,
    description: input.description || parsed.description,
    identifier,
    instructions: parsed.instructions,
    name: input.name || parsed.name,
    sourceRef: source?.sourceRef || input.sourceRef,
    sourceType: source?.sourceType || input.sourceType,
    sourceUrl: source?.sourceUrl,
  });

  return identifier;
};

const readBoundedResponse = async (response: Response, maxBytes: number) => {
  const declaredLength = Number(response.headers.get('content-length') || 0);
  if (declaredLength > maxBytes) throw new Error('Skill source exceeds the size limit');

  if (!response.body) {
    const text = await response.text();
    if (new TextEncoder().encode(text).byteLength > maxBytes) {
      throw new Error('Skill source exceeds the size limit');
    }
    return text;
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  let finished = false;

  while (!finished) {
    const { done, value } = await reader.read();
    finished = done;
    if (finished) break;
    totalBytes += value.byteLength;
    if (totalBytes > maxBytes) {
      await reader.cancel();
      throw new Error('Skill source exceeds the size limit');
    }
    chunks.push(value);
  }

  const body = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return new TextDecoder().decode(body);
};

const fetchText = async (sourceUrl: string, maxBytes: number, authorization?: string) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);

  try {
    const response = await ssrfSafeFetch(sourceUrl, {
      headers: authorization ? { authorization } : undefined,
      redirect: 'error',
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`Skill source returned HTTP ${response.status}`);
    return await readBoundedResponse(response, maxBytes);
  } finally {
    clearTimeout(timeout);
  }
};

export const skillRouter = router({
  getInstalledSkills: skillProcedure.query(({ ctx }) => ctx.skillModel.query()),

  getSkill: skillProcedure
    .input(z.object({ identifier: z.string().max(64) }))
    .query(({ input, ctx }) => ctx.skillModel.findById(input.identifier)),

  installSkill: skillProcedure
    .input(installInputSchema)
    .mutation(({ input, ctx }) => persistSkill(ctx.skillModel, input)),

  installSkillFromUrl: skillProcedure
    .input(
      z.object({
        authorization: z.string().max(4096).optional(),
        expectedIdentifier: z.string().max(64).refine(isSkillName).optional(),
        sourceRef: z.string().max(255).optional(),
        sourceType: sourceTypeSchema,
        sourceUrl: z.string().url(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const source = resolveSkillSource(input.sourceUrl, input.sourceType, input.sourceRef);
      const instructions = await fetchText(source.sourceUrl, MAX_SKILL_BYTES, input.authorization);

      return persistSkill(
        ctx.skillModel,
        {
          instructions,
          sourceRef: source.sourceRef,
          sourceType: source.sourceType,
          sourceUrl: source.sourceUrl,
        },
        input.expectedIdentifier,
      );
    }),

  removeSkill: skillProcedure
    .input(z.object({ identifier: z.string().max(64) }))
    .mutation(({ input, ctx }) => ctx.skillModel.delete(input.identifier)),

  resolveSkills: skillProcedure
    .input(z.object({ identifiers: z.array(z.string().max(64)).max(16) }))
    .query(async ({ input, ctx }) => {
      const records = await Promise.all(
        [...new Set(input.identifiers)].map((identifier) => ctx.skillModel.findById(identifier)),
      );

      return records.filter(Boolean).map((record) => ({
        contentHash: record!.contentHash,
        description: record!.description,
        identifier: record!.identifier,
        instructions: record!.instructions,
        name: record!.name,
      }));
    }),

  searchRegistry: skillProcedure
    .input(z.object({ query: z.string().max(100).optional() }))
    .query(async ({ input }) => {
      if (!appEnv.SKILLS_INDEX_URL) return { configured: false, items: [] };

      const url = new URL(appEnv.SKILLS_INDEX_URL);
      if (url.protocol !== 'https:' || url.username || url.password) {
        throw new Error('Skill registry URL must be an HTTPS URL without credentials');
      }
      if (input.query?.trim()) url.searchParams.set('q', input.query.trim());

      const raw = await fetchText(url.toString(), 1024 * 1024);
      let payload: unknown;
      try {
        payload = JSON.parse(raw);
      } catch {
        throw new Error('Skill registry returned invalid JSON');
      }

      return {
        configured: true,
        items: parseSkillRegistry(payload, input.query),
      };
    }),
});

export type SkillRouter = typeof skillRouter;
