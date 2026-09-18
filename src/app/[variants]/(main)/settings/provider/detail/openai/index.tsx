import { OpenAIProviderCard } from '@/config/modelProviders';

import { useSettingsContext } from '../../../_layout/ContextProvider';
import ProviderDetail from '../default';
import OpenAICodexSignIn from './OpenAICodexSignIn';

const Page = () => {
  const { showOpenAIProxyUrl, showOpenAIApiKey } = useSettingsContext();

  return (
    <ProviderDetail
      {...OpenAIProviderCard}
      extra={<OpenAICodexSignIn />}
      settings={{
        ...OpenAIProviderCard.settings,
        proxyUrl: showOpenAIProxyUrl && {
          placeholder: 'https://api.openai.com/v1',
        },
        showApiKey: showOpenAIApiKey,
      }}
    />
  );
};

export default Page;
