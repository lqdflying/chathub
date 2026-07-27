import { EnabledAiModel } from 'model-bank';

import {
  AiProviderDetailItem,
  AiProviderListItem,
  AiProviderRuntimeConfig,
  EnabledProvider,
  EnabledProviderWithModels,
} from '@/types/aiProvider';

export type AiProviderRuntimeInitializationFailureReason = 'request-failed';

export interface AiProviderRuntimeInitializationFailure {
  reason: AiProviderRuntimeInitializationFailureReason;
  scope: string;
}

export interface AIProviderState {
  activeAiProvider?: string;
  activeProviderModelList: any[];
  aiProviderConfigUpdatingIds: string[];
  aiProviderDetail?: AiProviderDetailItem | null;
  aiProviderList: AiProviderListItem[];
  aiProviderLoadingIds: string[];
  aiProviderRuntimeConfig: Record<string, AiProviderRuntimeConfig>;
  enabledAiModels?: EnabledAiModel[];
  enabledAiProviders?: EnabledProvider[];
  // used for select
  enabledChatModelList?: EnabledProviderWithModels[];
  enabledImageModelList?: EnabledProviderWithModels[];
  initAiProviderList: boolean;
  isInitAiProviderRuntimeState: boolean;
  providerSearchKeyword: string;
  runtimeStateInitializationFailure?: AiProviderRuntimeInitializationFailure;
  runtimeStateRequestScope?: string;
  runtimeStateScope?: string;
}

export const initialAIProviderState: AIProviderState = {
  activeProviderModelList: [],
  aiProviderConfigUpdatingIds: [],
  aiProviderList: [],
  aiProviderLoadingIds: [],
  aiProviderRuntimeConfig: {},
  initAiProviderList: false,
  isInitAiProviderRuntimeState: false,
  providerSearchKeyword: '',
  runtimeStateInitializationFailure: undefined,
  runtimeStateRequestScope: undefined,
  runtimeStateScope: undefined,
};
