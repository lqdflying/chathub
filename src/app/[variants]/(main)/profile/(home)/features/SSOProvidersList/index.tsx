import { ActionIcon, CopyButton, List } from '@lobehub/ui';
import { RotateCw, Unlink } from 'lucide-react';
import { CSSProperties, memo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Flexbox } from 'react-layout-kit';

import { modal, notification } from '@/components/AntdStaticMethods';
import AuthIcons from '@/components/NextAuth/AuthIcons';
import { useOnlyFetchOnceSWR } from '@/libs/swr';
import { userService } from '@/services/user';
import { useUserStore } from '@/store/user';
import { authSelectors, userProfileSelectors } from '@/store/user/selectors';
import {
  captureUserMutationSnapshot,
  isUserMutationCurrent,
} from '@/store/user/userMutation';

const { Item } = List;

const providerNameStyle: CSSProperties = {
  textTransform: 'capitalize',
};

export const SSOProvidersList = memo(() => {
  const [userProfile] = useUserStore((s) => [userProfileSelectors.userProfile(s)]);
  const requestedScope = useUserStore(authSelectors.currentUserScope);
  const { t } = useTranslation('auth');

  const [allowUnlink, setAllowUnlink] = useState<boolean>(false);
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  const { data, isLoading, mutate } = useOnlyFetchOnceSWR(
    requestedScope ? ['profile-sso-providers', requestedScope] : null,
    async () => userService.getUserSSOProviders(),
    {
      onSuccess: (list) => {
        if (authSelectors.currentUserScope(useUserStore.getState()) !== requestedScope) return;

        setAllowUnlink(list?.length > 1);
      },
    },
  );

  const handleUnlinkSSO = async (provider: string, providerAccountId: string) => {
    if (data?.length === 1 || !data) {
      // At least one SSO provider should be linked
      notification.error({
        message: t('profile.sso.unlink.forbidden'),
      });
      return;
    }
    modal.confirm({
      content: t('profile.sso.unlink.description', {
        email: userProfile?.email || 'None',
        provider,
        providerAccountId,
      }),
      okButtonProps: {
        danger: true,
      },
      onOk: async () => {
        const mutationSnapshot = captureUserMutationSnapshot(useUserStore.getState());
        const abortController = new AbortController();
        useUserStore.setState((state) => ({
          userMutationAbortControllers: [
            ...state.userMutationAbortControllers,
            abortController,
          ],
        }));

        try {
          await userService.unlinkSSOProvider(
            provider,
            providerAccountId,
            abortController.signal,
          );
          if (abortController.signal.aborted) return;
          if (!isUserMutationCurrent(useUserStore.getState(), mutationSnapshot)) return;

          await mutate();
        } finally {
          useUserStore.setState((state) => ({
            userMutationAbortControllers: state.userMutationAbortControllers.filter(
              (controller) => controller !== abortController,
            ),
          }));
        }
      },
      title: <span style={providerNameStyle}>{t('profile.sso.unlink.title', { provider })}</span>,
    });
  };

  return isLoading ? (
    <Flexbox align={'center'} gap={4} horizontal>
      <ActionIcon icon={RotateCw} spin />
      {t('profile.sso.loading')}
    </Flexbox>
  ) : (
    <Flexbox key={requestedScope || 'anonymous'}>
      {data?.map((item, index) => (
        <Item
          actions={
            <Flexbox gap={4} horizontal>
              <CopyButton content={item.providerAccountId} size={'small'} />
              <ActionIcon
                disabled={!allowUnlink}
                icon={Unlink}
                onClick={() => handleUnlinkSSO(item.provider, item.providerAccountId)}
                size={'small'}
              />
            </Flexbox>
          }
          avatar={AuthIcons(item.provider)}
          date={item.expires_at}
          description={item.providerAccountId}
          key={[item.provider, item.providerAccountId].join('-')}
          onMouseEnter={() => setHoveredIndex(index)}
          onMouseLeave={() => setHoveredIndex(null)}
          showAction={hoveredIndex === index}
          title={<span style={providerNameStyle}>{item.provider}</span>}
        />
      ))}
    </Flexbox>
  );
});

export default SSOProvidersList;
