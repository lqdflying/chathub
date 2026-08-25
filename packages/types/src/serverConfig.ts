import type { PartialDeep } from 'type-fest';

import { IFeatureFlagsState } from '@/config/featureFlags';

import { ChatModelCard } from './llm';
import {
  GlobalLLMProviderKey,
  UserDefaultAgent,
  UserImageConfig,
  UserSystemAgentConfig,
} from './user/settings';

export interface ServerModelProviderConfig {
  enabled?: boolean;
  enabledModels?: string[];
  fetchOnClient?: boolean;
  /**
   * the model cards defined in server
   */
  serverModelCards?: ChatModelCard[];
}

export type ServerLanguageModel = Partial<Record<GlobalLLMProviderKey, ServerModelProviderConfig>>;

export interface GlobalServerConfig {
  aiProvider: ServerLanguageModel;
  defaultAgent?: PartialDeep<UserDefaultAgent>;
  enableUploadFileToServer?: boolean;
  enabledAccessCode?: boolean;
  /**
   * A MarkItDown conversion sidecar is configured, so the Knowledge Base can
   * ingest every format MarkItDown converts, not just the built-in loaders'.
   */
  enabledMarkItDown?: boolean;
  /**
   * @deprecated
   */
  enabledOAuthSSO?: boolean;
  /**
   * CHATHUB_COMPACTION_DEBUG is active on the server, so the client emitter
   * should report planner/watcher diagnostics through reportCompactionDebug.
   */
  compactionDebug?: boolean;
  /**
   * CHATHUB_GENERATION_DEBUG is active on the server, so the client emitter
   * should report send-path diagnostics through reportClientDebug.
   */
  generationDebug?: boolean;
  image?: PartialDeep<UserImageConfig>;
  /**
   * @deprecated
   */
  languageModel?: ServerLanguageModel;
  oAuthSSOProviders?: string[];
  systemAgent?: PartialDeep<UserSystemAgentConfig>;
  telemetry: {
    langfuse?: boolean;
  };
}

export interface GlobalRuntimeConfig {
  serverConfig: GlobalServerConfig;
  serverFeatureFlags: IFeatureFlagsState;
}
