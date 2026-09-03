import { supportsTrustedPromptCacheKey } from '@lobechat/model-runtime';
import { ModelProvider, azure as azureModels, azureai as azureAIModels } from 'model-bank';

import { AiModelModel } from '@/database/models/aiModel';
import { getServerDB } from '@/database/server';
import { getServerGlobalConfig } from '@/server/globalConfig';

interface ModelDeployment {
  config?: {
    deploymentName?: string;
  };
  id: string;
}

interface ResolveTrustedCatalogModelParams {
  catalogModel?: string;
  deploymentName?: string;
  runtimeProvider: string;
  userId?: string;
}

interface ValidateAzureCatalogModelParams {
  catalogModel: string;
  deploymentName: string;
  serverModels: ModelDeployment[];
  userModels: ModelDeployment[];
}

const AZURE_DEPLOYMENT_PROVIDERS = new Set<string>([
  ModelProvider.Azure,
  ModelProvider.AzureAI,
]);

const isBoundedIdentifier = (value: string | undefined): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= 256;

const defaultModelsForProvider = (runtimeProvider: string): ModelDeployment[] =>
  (runtimeProvider === ModelProvider.AzureAI ? azureAIModels : azureModels) as ModelDeployment[];

export const validateAzureCatalogModel = ({
  catalogModel,
  deploymentName,
  serverModels,
  userModels,
}: ValidateAzureCatalogModelParams): string | undefined => {
  const userModel = userModels.find((model) => model.id === catalogModel);
  const serverModel = serverModels.find((model) => model.id === catalogModel);
  const configuredDeploymentName =
    userModel?.config?.deploymentName ?? serverModel?.config?.deploymentName;

  return configuredDeploymentName === deploymentName ? catalogModel : undefined;
};

export const resolveTrustedCatalogModel = async ({
  catalogModel,
  deploymentName,
  runtimeProvider,
  userId,
}: ResolveTrustedCatalogModelParams): Promise<string | undefined> => {
  if (
    !AZURE_DEPLOYMENT_PROVIDERS.has(runtimeProvider) ||
    !isBoundedIdentifier(catalogModel) ||
    !isBoundedIdentifier(deploymentName) ||
    !supportsTrustedPromptCacheKey(catalogModel)
  ) {
    return undefined;
  }

  try {
    const canReadUserModels = !!userId;
    const userModelsPromise = canReadUserModels
      ? getServerDB().then((database) =>
          new AiModelModel(database, userId).getModelListByProviderId(runtimeProvider),
        )
      : Promise.resolve([]);
    const [{ aiProvider }, userModels] = await Promise.all([
      getServerGlobalConfig(),
      userModelsPromise,
    ]);
    const serverModels = ((aiProvider as Record<string, { serverModelLists?: ModelDeployment[] }>)[
      runtimeProvider
    ]?.serverModelLists ?? defaultModelsForProvider(runtimeProvider)) as ModelDeployment[];

    return validateAzureCatalogModel({
      catalogModel,
      deploymentName,
      serverModels,
      userModels,
    });
  } catch {
    return undefined;
  }
};
