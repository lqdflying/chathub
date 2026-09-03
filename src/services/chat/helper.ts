import { ModelProvider } from 'model-bank';

import { getAiInfraStoreState } from '@/store/aiInfra';
import { aiModelSelectors, aiProviderSelectors } from '@/store/aiInfra/selectors';

export const isCanUseVision = (model: string, provider: string): boolean => {
  return aiModelSelectors.isModelSupportVision(model, provider)(getAiInfraStoreState());
};

export const isCanUseVideo = (model: string, provider: string): boolean => {
  return aiModelSelectors.isModelSupportVideo(model, provider)(getAiInfraStoreState()) || false;
};

/**
 * TODO: we need to update this function to auto find deploymentName with provider setting config
 */
const AZURE_DEPLOYMENT_PROVIDERS = new Set<string>([
  ModelProvider.Azure,
  ModelProvider.AzureAI,
]);

export const findDeploymentName = (model: string, provider: string) => {
  let deploymentId = model;

  const modelItem = getAiInfraStoreState().enabledAiModels?.find(
    (i) => i.id === model && i.providerId === provider,
  );

  if (modelItem?.config?.deploymentName) {
    deploymentId = modelItem.config.deploymentName;
  }

  return deploymentId;
};

/**
 * Browser-direct Azure requests cannot use the server catalog validator.
 * Reuse the same local mapping that rewrote the wire model, and never trust a
 * catalog claim that does not resolve to the outgoing deployment name.
 */
export const resolveClientTrustedCatalogModel = ({
  catalogModel,
  deploymentName,
  provider,
}: {
  catalogModel?: string;
  deploymentName?: string;
  provider: string;
}): string | undefined => {
  if (
    !AZURE_DEPLOYMENT_PROVIDERS.has(provider) ||
    !catalogModel ||
    !deploymentName ||
    findDeploymentName(catalogModel, provider) !== deploymentName
  ) {
    return undefined;
  }

  return catalogModel;
};

export const isEnableFetchOnClient = (provider: string) => {
  return aiProviderSelectors.isProviderFetchOnClient(provider)(getAiInfraStoreState());
};

export const resolveRuntimeProvider = (provider: string) => {
  const isBuiltin = Object.values(ModelProvider).includes(provider as any);
  if (isBuiltin) return provider;

  const providerConfig = aiProviderSelectors.providerConfigById(provider)(getAiInfraStoreState());

  return providerConfig?.settings.sdkType || 'openai';
};
