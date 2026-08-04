import { z } from 'zod';

import { ChatSemanticSearchChunk } from './chunk';

export const RAG_EMBEDDING_DIMENSIONS = 1024;

export const RagEmbeddingProviderSchema = z.enum(['openai', 'cohere', 'voyage']);

export type RagEmbeddingProvider = z.infer<typeof RagEmbeddingProviderSchema>;

const RagProviderBaseURLSchema = z
  .string()
  .trim()
  .url()
  .refine((value) => ['http:', 'https:'].includes(new URL(value).protocol), {
    message: 'The RAG provider URL must use HTTP or HTTPS.',
  });

/**
 * Credentials stored in the encrypted user key vault. The API key is never
 * returned to the browser by the provider status endpoint.
 */
export const RagProviderConfigSchema = z.object({
  apiKey: z.string().trim().min(1),
  baseURL: RagProviderBaseURLSchema.optional(),
  model: z.string().trim().min(1),
  provider: RagEmbeddingProviderSchema,
});

export type RagProviderConfig = z.infer<typeof RagProviderConfigSchema>;

export const RagProviderUpdateSchema = z.object({
  apiKey: z.string().trim().optional(),
  baseURL: RagProviderBaseURLSchema.optional().or(z.literal('')),
  model: z.string().trim().min(1),
  provider: RagEmbeddingProviderSchema,
});

export type RagProviderUpdate = z.infer<typeof RagProviderUpdateSchema>;

export interface RagProviderStatus {
  configured: boolean;
  dimensions: number;
  fingerprint?: string;
  model?: string;
  provider?: RagEmbeddingProvider;
  source: 'environment' | 'user' | 'none' | 'invalid';
  userOverride: {
    baseURL?: string;
    configured: boolean;
    exists: boolean;
    hasApiKey: boolean;
    model?: string;
    provider?: RagEmbeddingProvider;
  };
}

export const RAG_EMBEDDING_PRESETS: Record<RagEmbeddingProvider, { label: string; model: string }> =
  {
    cohere: { label: 'Cohere', model: 'embed-multilingual-v3.0' },
    openai: { label: 'OpenAI', model: 'text-embedding-3-small' },
    voyage: { label: 'Voyage AI', model: 'voyage-3.5' },
  };

export const SemanticSearchSchema = z.object({
  fileIds: z.array(z.string()).optional(),
  knowledgeIds: z.array(z.string()).optional(),
  messageId: z.string(),
  model: z.string().optional(),
  rewriteQuery: z.string(),
  userQuery: z.string(),
});

export type SemanticSearchSchemaType = z.infer<typeof SemanticSearchSchema>;

export type MessageSemanticSearchChunk = Pick<ChatSemanticSearchChunk, 'id' | 'similarity'>;
