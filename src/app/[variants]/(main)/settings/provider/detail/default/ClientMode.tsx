'use client';

import { memo } from 'react';
import { Flexbox } from 'react-layout-kit';

import Loading from '@/components/Loading/BrandTextLoading';
import { useClientDataSWR } from '@/libs/swr';
import { aiProviderService } from '@/services/aiProvider';
import { useAiInfraStore } from '@/store/aiInfra';
import { useUserStore } from '@/store/user';
import { authSelectors } from '@/store/user/selectors';

import ModelList from '../../features/ModelList';
import ProviderConfig from '../../features/ProviderConfig';

const ClientMode = memo<{ id: string }>(({ id }) => {
  const useFetchAiProviderItem = useAiInfraStore((s) => s.useFetchAiProviderItem);
  const userScope = useUserStore(authSelectors.currentUserScope);
  useFetchAiProviderItem(id);

  const { data, isLoading } = useClientDataSWR(
    userScope ? ['get-client-provider', userScope, id] : null,
    () => aiProviderService.getAiProviderById(id),
  );

  if (isLoading || !data || !data.id) return <Loading />;

  return (
    <Flexbox gap={24} paddingBlock={8}>
      <ProviderConfig {...data} id={id} name={data.name || ''} />
      <ModelList id={id} />
    </Flexbox>
  );
});

export default ClientMode;
