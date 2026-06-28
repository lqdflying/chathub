'use client';

import { Select } from 'antd';
import { ModelProvider } from 'model-bank';
import { useTranslation } from 'react-i18next';

import { FormPassword } from '@/components/FormInput';
import { AnthropicCompatibleProviderCard } from '@/config/modelProviders';
import { aiProviderSelectors, useAiInfraStore } from '@/store/aiInfra';

import { KeyVaultsConfigKey, LLMProviderApiTokenKey } from '../../const';
import { SkeletonInput } from '../../features/ProviderConfig';
import { ProviderItem } from '../../type';
import ProviderDetail from '../default';

const providerKey = ModelProvider.AnthropicCompatible;

const useProviderCard = (): ProviderItem => {
  const { t } = useTranslation('modelProvider');
  const isLoading = useAiInfraStore(aiProviderSelectors.isAiProviderConfigLoading(providerKey));

  return {
    ...AnthropicCompatibleProviderCard,
    apiKeyItems: [
      {
        children: isLoading ? (
          <SkeletonInput />
        ) : (
          <FormPassword
            autoComplete={'new-password'}
            placeholder={t('providerModels.config.apiKey.placeholder', { name: 'Anthropic Compatible' })}
          />
        ),
        desc: t('providerModels.config.apiKey.desc', { name: 'Anthropic Compatible' }),
        label: t('providerModels.config.apiKey.title'),
        name: [KeyVaultsConfigKey, LLMProviderApiTokenKey],
      },
      {
        children: isLoading ? (
          <SkeletonInput />
        ) : (
          <Select
            options={[
              { label: 'x-api-key (Anthropic native)', value: 'api-key' },
              { label: 'Bearer Token (Authorization: Bearer)', value: 'bearer' },
            ]}
            placeholder={'x-api-key'}
          />
        ),
        desc: t('anthropicCompatible.authMode.desc'),
        label: t('anthropicCompatible.authMode.title'),
        name: [KeyVaultsConfigKey, 'authMode'],
      },
    ],
  };
};

const Page = () => {
  const card = useProviderCard();

  return <ProviderDetail {...card} />;
};

export default Page;
