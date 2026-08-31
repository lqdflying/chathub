import { Button } from '@lobehub/ui';
import { ModelProvider } from 'model-bank';
import { memo, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Center, Flexbox } from 'react-layout-kit';

import { ProviderBrandIcon } from '@/components/ProviderBrandIcon';
import { GlobalLLMProviderKey } from '@/types/user/settings';

import { LoadingContext } from './LoadingContext';
import ProviderApiKeyForm from './ProviderApiKeyForm';

interface APIKeyFormProps {
  description: string;
  id: string;
  loading?: boolean;
  onClose: () => void;
  onRecreate: () => void;
  provider?: string;
}

const APIKeyForm = memo<APIKeyFormProps>(
  ({ provider, description, loading: regenerationLoading = false, onRecreate, onClose }) => {
    const { t } = useTranslation('error');
    const [configurationLoading, setConfigurationLoading] = useState(false);
    const loading = configurationLoading || regenerationLoading;

    const apiKeyPlaceholder = useMemo(() => {
      switch (provider) {
        case ModelProvider.Anthropic: {
          return 'sk-ant_*****************************';
        }

        default: {
          return '*********************************';
        }
      }
    }, [provider]);

    return (
      <LoadingContext value={{ loading, setLoading: setConfigurationLoading }}>
        <Center
          gap={16}
          style={{
            maxWidth: 300,
            width: 'auto',
          }}
        >
          <ProviderApiKeyForm
            apiKeyPlaceholder={apiKeyPlaceholder}
            avatar={<ProviderBrandIcon provider={provider || ''} size={80} type={'avatar'} />}
            description={description}
            provider={provider as GlobalLLMProviderKey}
            showEndpoint
          />
          <Flexbox gap={12} width={'100%'}>
            <Button
              block
              disabled={loading}
              loading={regenerationLoading}
              onClick={() => {
                onRecreate();
              }}
              style={{ marginTop: 8 }}
              type={'primary'}
            >
              {t('unlock.confirm')}
            </Button>
            <Button
              onClick={() => {
                onClose();
              }}
            >
              {t('unlock.closeMessage')}
            </Button>
          </Flexbox>
        </Center>
      </LoadingContext>
    );
  },
);

export default APIKeyForm;
