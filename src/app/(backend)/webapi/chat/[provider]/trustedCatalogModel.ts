import { supportsTrustedPromptCacheKey } from '@lobechat/model-runtime';
import { ModelProvider, azure as azureModels } from 'model-bank';

import { isDesktop, isServerMode } from '@/const/version';
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

const isBoundedIdentifier = (value: string | undefined): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= 256;

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
    runtimeProvider !== ModelProvider.Azure ||
    !isBoundedIdentifier(catalogModel) ||
    !isBoundedIdentifier(deploymentName) ||
    !supportsTrustedPromptCacheKey(catalogModel)
  ) {
    return undefined;
  }

  try {
    const canReadUserModels = !!userId && (isServerMode || isDesktop);
    const userModelsPromise = canReadUserModels
      ? getServerDB().then((database) =>
          new AiModelModel(database, userId).getModelListByProviderId(ModelProvider.Azure),
        )
      : Promise.resolve([]);
    const [{ aiProvider }, userModels] = await Promise.all([
      getServerGlobalConfig(),
      userModelsPromise,
    ]);
    const serverModels = (aiProvider[ModelProvider.Azure]?.serverModelLists ??
      azureModels) as ModelDeployment[];

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
