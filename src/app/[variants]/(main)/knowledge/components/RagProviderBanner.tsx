'use client';

import type { RagProviderStatus } from '@lobechat/types';
import { Alert, Button } from '@lobehub/ui';
import { Settings2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useClientDataSWR } from '@/libs/swr';
import { ragProviderService } from '@/services/ragProvider';
import { SettingsTabs } from '@/store/global/initialState';
import { useUserStore } from '@/store/user';
import { authSelectors } from '@/store/user/selectors';

const RagProviderBanner = memo(() => {
  const { t } = useTranslation('knowledgeBase');
  const router = useRouter();
  const scope = useUserStore(authSelectors.currentUserScope);
  const { data, error } = useClientDataSWR<RagProviderStatus>(
    scope ? ['rag-provider-status', scope] : null,
    () => ragProviderService.getStatus(),
  );

  if (!error && (!data || data.configured)) return null;

  return (
    <Alert
      action={
        <Button
          icon={Settings2}
          onClick={() => router.push(`/settings?active=${SettingsTabs.RagProvider}`)}
          size={'small'}
        >
          {t('ragProvider.configure')}
        </Button>
      }
      banner
      description={t('ragProvider.description')}
      message={t('ragProvider.title')}
      showIcon
      type={'warning'}
    />
  );
});

RagProviderBanner.displayName = 'RagProviderBanner';

export default RagProviderBanner;
