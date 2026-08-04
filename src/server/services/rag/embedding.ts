import type { LobeChatDatabase } from '@lobechat/database';
import type {
  RagEmbeddingProvider,
  RagProviderConfig,
  RagProviderStatus,
  RagProviderUpdate,
  UserKeyVaults,
} from '@lobechat/types';
import {
  RAG_EMBEDDING_DIMENSIONS,
  RAG_EMBEDDING_PRESETS,
  RagEmbeddingProviderSchema,
  RagProviderBaseURLSchema,
  RagProviderConfigSchema,
} from '@lobechat/types';
import { createHash } from 'node:crypto';

import { UserModel, UserNotFoundError } from '@/database/models/user';
import { knowledgeEnv } from '@/envs/knowledge';
import {
  describeKnowledgeDebugError,
  logKnowledgeDebugSafe,
  logKnowledgeDebugVerbose,
} from '@/libs/logger/knowledgeDebug';
import { KeyVaultsGateKeeper } from '@/server/modules/KeyVaultsEncrypt';

export const RAG_PROVIDER_ENV_KEYS = [
  'RAG_EMBEDDING_PROVIDER',
  'RAG_EMBEDDING_MODEL',
  'RAG_EMBEDDING_API_KEY',
  'RAG_EMBEDDING_BASE_URL',
] as const;

const RAG_PROVIDER_TIMEOUT_MS = 60_000;

const DEFAULT_ENDPOINTS: Record<RagEmbeddingProvider, string> = {
  cohere: 'https://api.cohere.com',
  openai: 'https://api.openai.com/v1',
  voyage: 'https://api.voyageai.com/v1',
};

export class RagProviderNotConfiguredError extends Error {
  code = 'RAG_PROVIDER_NOT_CONFIGURED';

  constructor(message = 'Configure a RAG embedding provider before indexing or searching.') {
    super(message);
    this.name = 'RagProviderNotConfiguredError';
  }
}

export class RagEmbeddingProviderError extends Error {
  code = 'RAG_PROVIDER_ERROR';

  constructor(message: string) {
    super(message);
    this.name = 'RagEmbeddingProviderError';
  }
}

export class RagKeyVaultsUnreadableError extends Error {
  code = 'RAG_KEY_VAULTS_UNREADABLE';

  constructor() {
    super(
      'Saved credentials cannot be decrypted. Verify KEY_VAULTS_SECRET before changing RAG settings.',
    );
    this.name = 'RagKeyVaultsUnreadableError';
  }
}

const clean = (value?: string | null) => value?.trim() || undefined;

const normalizeBaseURL = (provider: RagEmbeddingProvider, value?: string) => {
  const raw = clean(value) || DEFAULT_ENDPOINTS[provider];
  const url = new URL(raw);
  url.hash = '';
  url.password = '';
  url.search = '';
  url.username = '';
  url.pathname = url.pathname.replace(/\/+$/, '');
  return url.toString().replace(/\/+$/, '');
};

export const getRagEnvironmentConfig = (): RagProviderConfig | undefined => {
  const provider = clean(knowledgeEnv.RAG_EMBEDDING_PROVIDER) as RagEmbeddingProvider | undefined;
  const model = clean(knowledgeEnv.RAG_EMBEDDING_MODEL);
  const apiKey = clean(knowledgeEnv.RAG_EMBEDDING_API_KEY);

  if (!provider && !model && !apiKey) return undefined;
  if (!provider || !model || !apiKey) return undefined;

  const parsed = RagProviderConfigSchema.safeParse({
    apiKey,
    baseURL: clean(knowledgeEnv.RAG_EMBEDDING_BASE_URL),
    model,
    provider,
  });

  return parsed.success ? parsed.data : undefined;
};

const hasRagEnvironmentConfig = () =>
  RAG_PROVIDER_ENV_KEYS.some((key) => !!clean(knowledgeEnv[key]));

export const getRagUserKeyVaults = async (
  db: LobeChatDatabase,
  userId: string,
): Promise<UserKeyVaults> => {
  const gateKeeper = await KeyVaultsGateKeeper.initWithEnvKey();

  return UserModel.getUserApiKeys(db, userId, async (encryptedKeyVaults) => {
    if (!encryptedKeyVaults) return {};

    let plaintext: string;
    let wasAuthentic: boolean;
    try {
      ({ plaintext, wasAuthentic } = await gateKeeper.decrypt(encryptedKeyVaults));
    } catch {
      throw new RagKeyVaultsUnreadableError();
    }
    if (!wasAuthentic) throw new RagKeyVaultsUnreadableError();

    try {
      const parsed = JSON.parse(plaintext) as unknown;
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new RagKeyVaultsUnreadableError();
      }
      return parsed as UserKeyVaults;
    } catch (error) {
      if (error instanceof RagKeyVaultsUnreadableError) throw error;
      throw new RagKeyVaultsUnreadableError();
    }
  });
};

export const mergeBrowserKeyVaultsPreservingRag = (
  current: UserKeyVaults,
  browserValue: UserKeyVaults,
): UserKeyVaults => {
  const next = { ...browserValue };
  delete next.rag;
  if (current.rag) next.rag = current.rag;
  return next;
};

const isComplete = (value: unknown): value is RagProviderConfig =>
  RagProviderConfigSchema.safeParse(value).success;

export const getRagFingerprint = (config: RagProviderConfig) =>
  `rag:${createHash('sha256')
    .update(
      [
        config.provider,
        normalizeBaseURL(config.provider, config.baseURL),
        config.model,
        RAG_EMBEDDING_DIMENSIONS,
      ].join('\n'),
    )
    .digest('hex')}`;

export const resolveRagEmbeddingConfig = async (
  db: LobeChatDatabase,
  userId: string,
): Promise<{
  config?: RagProviderConfig;
  fingerprint?: string;
  source: RagProviderStatus['source'];
  userOverride?: RagProviderConfig;
}> => {
  let keyVaults: Record<string, unknown> = {};
  try {
    keyVaults = (await getRagUserKeyVaults(db, userId)) as Record<string, unknown>;
  } catch (error) {
    if (error instanceof RagKeyVaultsUnreadableError) return { source: 'invalid' };
    if (!(error instanceof UserNotFoundError)) throw error;
    // A user may not have a settings row yet. Environment configuration can
    // still provide the service in that case.
  }

  const userValue = keyVaults.rag;
  const hasUserOverride = !!userValue && typeof userValue === 'object';
  if (hasUserOverride) {
    if (!isComplete(userValue)) {
      return { source: 'invalid' };
    }
    const config = userValue as RagProviderConfig;
    return { config, fingerprint: getRagFingerprint(config), source: 'user', userOverride: config };
  }

  const config = getRagEnvironmentConfig();
  if (!config) return { source: hasRagEnvironmentConfig() ? 'invalid' : 'none' };

  return { config, fingerprint: getRagFingerprint(config), source: 'environment' };
};

const getUserOverrideSummary = async (db: LobeChatDatabase, userId: string) => {
  try {
    const keyVaults = (await getRagUserKeyVaults(db, userId)) as Record<string, any>;
    const rag = keyVaults.rag;
    if (!rag || typeof rag !== 'object') {
      return { configured: false, exists: false, hasApiKey: false };
    }
    const baseURL = RagProviderBaseURLSchema.safeParse(rag.baseURL);
    const provider = RagEmbeddingProviderSchema.safeParse(rag.provider);
    return {
      baseURL: baseURL.success ? baseURL.data : undefined,
      configured: isComplete(rag),
      exists: true,
      hasApiKey: !!clean(rag.apiKey),
      model: clean(rag.model),
      provider: provider.success ? provider.data : undefined,
    };
  } catch {
    return { configured: false, exists: false, hasApiKey: false };
  }
};

export const getRagProviderStatus = async (
  db: LobeChatDatabase,
  userId: string,
): Promise<RagProviderStatus> => {
  const resolved = await resolveRagEmbeddingConfig(db, userId);
  const userOverride = resolved.userOverride;
  const userKeyVaults = userOverride
    ? {
        baseURL: userOverride.baseURL,
        configured: true,
        exists: true,
        hasApiKey: true,
        model: userOverride.model,
        provider: userOverride.provider,
      }
    : await getUserOverrideSummary(db, userId);

  return {
    configured: !!resolved.config,
    dimensions: RAG_EMBEDDING_DIMENSIONS,
    fingerprint: resolved.fingerprint,
    model: resolved.config?.model,
    provider: resolved.config?.provider,
    source: resolved.source,
    userOverride: userKeyVaults,
  };
};

export const mergeRagProviderUpdate = (
  current: RagProviderConfig | undefined,
  update: RagProviderUpdate,
): RagProviderConfig => {
  const candidate = {
    apiKey:
      clean(update.apiKey) || (current?.provider === update.provider ? current.apiKey : undefined),
    baseURL: clean(update.baseURL) || undefined,
    model: update.model,
    provider: update.provider,
  };
  const parsed = RagProviderConfigSchema.safeParse(candidate);
  if (!parsed.success) {
    throw new RagProviderNotConfiguredError('A provider, model, and API key are required.');
  }
  return parsed.data;
};

export const getRagPreset = (provider: RagEmbeddingProvider) => RAG_EMBEDDING_PRESETS[provider];

const endpointFor = (config: RagProviderConfig) => {
  const base = normalizeBaseURL(config.provider, config.baseURL);
  switch (config.provider) {
    case 'cohere': {
      if (base.endsWith('/embed')) return base;
      return base.endsWith('/v2') ? `${base}/embed` : `${base}/v2/embed`;
    }
    default: {
      return base.endsWith('/embeddings') ? base : `${base}/embeddings`;
    }
  }
};

const parseProviderError = async (response: Response) => {
  const body = await response.text();
  let message = body;
  try {
    const parsed = JSON.parse(body);
    message = parsed?.error?.message || parsed?.message || parsed?.detail || body;
  } catch {
    // Keep the plain response when it is not JSON.
  }
  return `${response.status} ${response.statusText}: ${String(message).slice(0, 500)}`;
};

export class RagEmbeddingService {
  constructor(private readonly config: RagProviderConfig) {}

  embed = async (
    input: string | string[],
    inputType: 'document' | 'query' = 'document',
  ): Promise<number[][]> => {
    const values = Array.isArray(input) ? input : [input];
    if (values.length === 0) return [];

    const startedAt = Date.now();
    logKnowledgeDebugSafe('embedding_provider_started', {
      inputCount: values.length,
      inputType,
      phase: 'embedding_provider',
      totalCharacters: values.reduce((total, value) => total + value.length, 0),
    });
    logKnowledgeDebugVerbose('embedding_provider_started', {
      inputLengths: values.map((value) => value.length),
      inputTexts: values,
      inputType,
      model: this.config.model,
      provider: this.config.provider,
    });

    try {
      const commonHeaders = {
        'Authorization': `Bearer ${this.config.apiKey}`,
        'Content-Type': 'application/json',
      };
      let body: Record<string, unknown>;
      switch (this.config.provider) {
        case 'cohere': {
          body = {
            embedding_types: ['float'],
            input_type: inputType === 'query' ? 'search_query' : 'search_document',
            model: this.config.model,
            texts: values,
          };
          break;
        }
        case 'voyage': {
          body = {
            input: values,
            input_type: inputType,
            model: this.config.model,
            output_dimension: RAG_EMBEDDING_DIMENSIONS,
          };
          break;
        }
        default: {
          body = {
            dimensions: RAG_EMBEDDING_DIMENSIONS,
            input: values,
            model: this.config.model,
          };
        }
      }

      let response: Response;
      try {
        response = await fetch(endpointFor(this.config), {
          body: JSON.stringify(body),
          headers: commonHeaders,
          method: 'POST',
          signal: AbortSignal.timeout(RAG_PROVIDER_TIMEOUT_MS),
        });
      } catch (error) {
        throw new RagEmbeddingProviderError(
          `Embedding provider request failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      if (!response.ok) throw new RagEmbeddingProviderError(await parseProviderError(response));

      let payload: any;
      try {
        payload = await response.json();
      } catch {
        throw new RagEmbeddingProviderError('The embedding provider returned invalid JSON.');
      }
      const data = Array.isArray(payload?.data) ? payload.data : undefined;
      const vectors =
        this.config.provider === 'cohere'
          ? payload?.embeddings?.float
          : this.config.provider === 'voyage'
            ? data?.map((item: any) => item.embedding)
            : data
                ?.sort((a: any, b: any) => (a.index ?? 0) - (b.index ?? 0))
                .map((item: any) => item.embedding);

      if (!Array.isArray(vectors) || vectors.length !== values.length) {
        throw new RagEmbeddingProviderError(
          'The embedding provider returned an invalid vector count.',
        );
      }
      if (
        vectors.some(
          (vector: unknown) =>
            !Array.isArray(vector) ||
            vector.length !== RAG_EMBEDDING_DIMENSIONS ||
            vector.some((value) => typeof value !== 'number' || !Number.isFinite(value)),
        )
      ) {
        throw new RagEmbeddingProviderError(
          `The embedding provider must return ${RAG_EMBEDDING_DIMENSIONS}-dimensional vectors.`,
        );
      }
      logKnowledgeDebugSafe('embedding_provider_settled', {
        dimensions: vectors[0]?.length ?? 0,
        durationMs: Date.now() - startedAt,
        inputCount: values.length,
        inputType,
        outcome: 'completed',
        phase: 'embedding_provider',
        vectorCount: vectors.length,
      });
      return vectors as number[][];
    } catch (error) {
      logKnowledgeDebugSafe('embedding_provider_settled', {
        ...describeKnowledgeDebugError(error),
        durationMs: Date.now() - startedAt,
        inputCount: values.length,
        inputType,
        outcome: 'failed',
        phase: 'embedding_provider',
      });
      throw error;
    }
  };

  testConnection = async () => {
    await this.embed('ChatHub RAG provider connection test', 'query');
    return true;
  };
}
