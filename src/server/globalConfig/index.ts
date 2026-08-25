import { enableNextAuth } from '@/const/auth';
import { appEnv, getAppConfig } from '@/envs/app';
import { authEnv } from '@/envs/auth';
import { fileEnv } from '@/envs/file';
import { imageEnv } from '@/envs/image';
import { knowledgeEnv } from '@/envs/knowledge';
import { langfuseEnv } from '@/envs/langfuse';
import { isCompactionDebugEnabled } from '@/libs/logger/compactionDebug';
import { isGenerationDebugEnabled } from '@/libs/logger/generationDebug';
import { parseAuthProviders } from '@/libs/next-auth/parseAuthProviders';
import { parseSystemAgent } from '@/server/globalConfig/parseSystemAgent';
import { GlobalServerConfig } from '@/types/serverConfig';
import { cleanObject } from '@/utils/object';

import { genServerLLMConfig } from './_deprecated';
import { genServerAiProvidersConfig } from './genServerAiProviderConfig';
import { parseAgentConfig } from './parseDefaultAgent';
import { parseFilesConfig } from './parseFilesConfig';

export const getServerGlobalConfig = async () => {
  const { ACCESS_CODES, DEFAULT_AGENT_CONFIG } = getAppConfig();

  const config: GlobalServerConfig = {
    aiProvider: await genServerAiProvidersConfig({
      anthropiccompatible: {
        fixedModelList: true,
      },
      azure: {
        enabledKey: 'ENABLED_AZURE_OPENAI',
        withDeploymentName: true,
      },
      openaicompatible: {
        fixedModelList: true,
      },
      /* ↓ cloud slot ↓ */

      /* ↑ cloud slot ↑ */
    }),
    defaultAgent: {
      config: parseAgentConfig(DEFAULT_AGENT_CONFIG),
    },
    enableUploadFileToServer: !!fileEnv.S3_SECRET_ACCESS_KEY,
    enabledAccessCode: ACCESS_CODES?.length > 0,
    enabledMarkItDown: !!knowledgeEnv.MARKITDOWN_SERVICE_URL,

    compactionDebug: isCompactionDebugEnabled(),
    enabledOAuthSSO: enableNextAuth,
    generationDebug: isGenerationDebugEnabled(),
    image: cleanObject({
      defaultImageNum: imageEnv.AI_IMAGE_DEFAULT_IMAGE_NUM,
    }),
    /**
     * @deprecated
     */
    languageModel: genServerLLMConfig({
      anthropiccompatible: {
        fixedModelList: true,
      },
      azure: {
        enabledKey: 'ENABLED_AZURE_OPENAI',
        withDeploymentName: true,
      },
      openaicompatible: {
        fixedModelList: true,
      },
    }),
    oAuthSSOProviders: parseAuthProviders(authEnv.NEXT_AUTH_SSO_PROVIDERS),
    systemAgent: parseSystemAgent(appEnv.SYSTEM_AGENT),
    telemetry: {
      langfuse: langfuseEnv.ENABLE_LANGFUSE,
    },
  };

  return config;
};

export const getServerDefaultAgentConfig = () => {
  const { DEFAULT_AGENT_CONFIG } = getAppConfig();

  return parseAgentConfig(DEFAULT_AGENT_CONFIG) || {};
};

export const getServerDefaultFilesConfig = () => {
  return parseFilesConfig(knowledgeEnv.DEFAULT_FILES_CONFIG);
};
