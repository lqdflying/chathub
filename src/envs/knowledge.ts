import { createEnv } from '@t3-oss/env-nextjs';
import { z } from 'zod';

export const knowledgeEnv = createEnv({
  runtimeEnv: {
    DEFAULT_FILES_CONFIG: process.env.DEFAULT_FILES_CONFIG,
    FILE_TYPE_CHUNKING_RULES: process.env.FILE_TYPE_CHUNKING_RULES,
    MARKITDOWN_API_KEY: process.env.MARKITDOWN_API_KEY,
    MARKITDOWN_MAX_FILE_SIZE: process.env.MARKITDOWN_MAX_FILE_SIZE,
    MARKITDOWN_SERVICE_URL: process.env.MARKITDOWN_SERVICE_URL,
    MARKITDOWN_TIMEOUT: process.env.MARKITDOWN_TIMEOUT,
    RAG_EMBEDDING_API_KEY: process.env.RAG_EMBEDDING_API_KEY,
    RAG_EMBEDDING_BASE_URL: process.env.RAG_EMBEDDING_BASE_URL,
    RAG_EMBEDDING_MODEL: process.env.RAG_EMBEDDING_MODEL,
    RAG_EMBEDDING_PROVIDER: process.env.RAG_EMBEDDING_PROVIDER,
    UNSTRUCTURED_API_KEY: process.env.UNSTRUCTURED_API_KEY,
    UNSTRUCTURED_SERVER_URL: process.env.UNSTRUCTURED_SERVER_URL,
  },
  server: {
    DEFAULT_FILES_CONFIG: z.string().optional(),
    FILE_TYPE_CHUNKING_RULES: z.string().optional(),
    // Optional bearer token expected by the MarkItDown sidecar.
    MARKITDOWN_API_KEY: z.string().optional(),
    // Refuse to ship anything larger than this to the converter (bytes).
    MARKITDOWN_MAX_FILE_SIZE: z.coerce
      .number()
      .int()
      .positive()
      .default(100 * 1024 * 1024),
    // Base URL of the MarkItDown conversion sidecar, e.g. http://markitdown:5000
    MARKITDOWN_SERVICE_URL: z.string().url().optional(),
    MARKITDOWN_TIMEOUT: z.coerce.number().int().positive().default(180_000),
    RAG_EMBEDDING_API_KEY: z.string().optional(),
    // Validate the RAG provider as a complete unit in the provider resolver so
    // an incomplete deployment configuration can be reported in the UI.
    RAG_EMBEDDING_BASE_URL: z.string().optional(),
    RAG_EMBEDDING_MODEL: z.string().optional(),
    RAG_EMBEDDING_PROVIDER: z.string().optional(),
    UNSTRUCTURED_API_KEY: z.string().optional(),
    UNSTRUCTURED_SERVER_URL: z.string().optional(),
  },
});
