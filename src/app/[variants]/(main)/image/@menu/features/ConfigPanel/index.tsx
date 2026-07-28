'use client';

import { Alert, Button, Text } from '@lobehub/ui';
import { LogIn, RefreshCw } from 'lucide-react';
import React, { ReactNode, memo, useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Center, Flexbox } from 'react-layout-kit';

import { useAiInfraStore } from '@/store/aiInfra';
import { imageGenerationConfigSelectors } from '@/store/image/selectors';
import { useDimensionControl } from '@/store/image/slices/generationConfig/hooks';
import { useImageStore } from '@/store/image/store';
import { useUserStore } from '@/store/user';
import { authSelectors } from '@/store/user/selectors';

import CfgSliderInput from './components/CfgSliderInput';
import DimensionControlGroup from './components/DimensionControlGroup';
import ImageConfigSkeleton from './components/ImageConfigSkeleton';
import ImageNum from './components/ImageNum';
import ImageUrl from './components/ImageUrl';
import ImageUrlsUpload from './components/ImageUrlsUpload';
import ModelSelect from './components/ModelSelect';
import QualitySelect from './components/QualitySelect';
import SeedNumberInput from './components/SeedNumberInput';
import SizeSelect from './components/SizeSelect';
import StepsSliderInput from './components/StepsSliderInput';

interface ConfigItemLayoutProps {
  children: ReactNode;
  label?: string;
}

const ConfigItemLayout = memo<ConfigItemLayoutProps>(({ label, children }) => {
  return (
    <Flexbox gap={8}>
      {label && <Text weight={500}>{label}</Text>}
      {children}
    </Flexbox>
  );
});

const isSupportedParamSelector = imageGenerationConfigSelectors.isSupportedParam;

const ConfigPanel = memo(() => {
  const { t } = useTranslation('image');

  // All hooks must be called before any early returns
  const [retryingScope, setRetryingScope] = useState<string>();

  const isInit = useImageStore((s) => s.isInit);
  const isImageModelAvailable = useImageStore((s) => s.isImageModelAvailable);
  const isSupportImageUrl = useImageStore(isSupportedParamSelector('imageUrl'));
  const isSupportSize = useImageStore(isSupportedParamSelector('size'));
  const isSupportQuality = useImageStore(isSupportedParamSelector('quality'));
  const isSupportSeed = useImageStore(isSupportedParamSelector('seed'));
  const isSupportSteps = useImageStore(isSupportedParamSelector('steps'));
  const isSupportCfg = useImageStore(isSupportedParamSelector('cfg'));
  const isSupportImageUrls = useImageStore(isSupportedParamSelector('imageUrls'));

  const isAuthLoaded = useUserStore(authSelectors.isLoaded);
  const isLogin = useUserStore(authSelectors.isLogin);
  const currentUserScope = useUserStore(authSelectors.currentUserScope);
  const userStateInitializationFailure = useUserStore(
    (state) => state.userStateInitializationFailure,
  );
  const logout = useUserStore((state) => state.logout);
  const refreshUserState = useUserStore((state) => state.refreshUserState);
  const runtimeStateInitializationFailure = useAiInfraStore(
    (state) => state.runtimeStateInitializationFailure,
  );
  const refreshAiProviderRuntimeState = useAiInfraStore(
    (state) => state.refreshAiProviderRuntimeState,
  );

  const { showDimensionControl } = useDimensionControl();

  const hasUserStateFailure =
    !!currentUserScope && userStateInitializationFailure?.scope === currentUserScope;
  const hasOwnerMismatch =
    hasUserStateFailure && userStateInitializationFailure?.reason === 'owner-mismatch';
  const hasProviderRuntimeFailure =
    !!currentUserScope && runtimeStateInitializationFailure?.scope === currentUserScope;
  const hasUnresolvedAuthenticatedScope = isAuthLoaded && !!isLogin && !currentUserScope;
  const hasBootstrapFailure =
    hasUserStateFailure || hasProviderRuntimeFailure || hasUnresolvedAuthenticatedScope;
  const isRetryingCurrentScope = !!currentUserScope && retryingScope === currentUserScope;

  const handleRetry = useCallback(async () => {
    if (
      !currentUserScope ||
      hasOwnerMismatch ||
      (!hasUserStateFailure && !hasProviderRuntimeFailure)
    ) {
      return;
    }

    const requestedScope = currentUserScope;
    setRetryingScope(requestedScope);
    const refreshRequests: Promise<void>[] = [];
    if (hasUserStateFailure) {
      refreshRequests.push(refreshUserState());
    }
    if (hasProviderRuntimeFailure) {
      refreshRequests.push(refreshAiProviderRuntimeState());
    }

    await Promise.allSettled(refreshRequests);
    setRetryingScope((activeRetryScope) =>
      activeRetryScope === requestedScope ? undefined : activeRetryScope,
    );
  }, [
    currentUserScope,
    hasOwnerMismatch,
    hasProviderRuntimeFailure,
    hasUserStateFailure,
    refreshAiProviderRuntimeState,
    refreshUserState,
  ]);
  const handleSignInAgain = useCallback(async () => {
    await logout();
  }, [logout]);

  if (isRetryingCurrentScope) {
    return <ImageConfigSkeleton />;
  }

  if (hasBootstrapFailure) {
    return (
      <Center height={'100%'} padding={16} width={'100%'}>
        <Alert
          action={
            hasOwnerMismatch ? (
              <Button icon={LogIn} onClick={handleSignInAgain} size={'small'} type={'primary'}>
                {t('config.bootstrapFailure.signInAgain')}
              </Button>
            ) : (
              !hasUnresolvedAuthenticatedScope && (
                <Button icon={RefreshCw} onClick={handleRetry} size={'small'} type={'primary'}>
                  {t('config.bootstrapFailure.retry')}
                </Button>
              )
            )
          }
          description={t(
            hasOwnerMismatch
              ? 'config.bootstrapFailure.ownerMismatchDescription'
              : hasUnresolvedAuthenticatedScope
                ? 'config.bootstrapFailure.accountDescription'
                : 'config.bootstrapFailure.description',
          )}
          message={t('config.bootstrapFailure.title')}
          showIcon
          type={'error'}
        />
      </Center>
    );
  }

  if (!isInit) {
    return <ImageConfigSkeleton />;
  }

  return (
    <Flexbox gap={32} padding="12px 12px 24px" style={{ height: '100%', overflow: 'auto' }}>
      <ConfigItemLayout>
        <ModelSelect />
      </ConfigItemLayout>

      {isImageModelAvailable && isSupportImageUrl && (
        <ConfigItemLayout label={t('config.imageUrl.label')}>
          <ImageUrl />
        </ConfigItemLayout>
      )}

      {isImageModelAvailable && isSupportImageUrls && (
        <ConfigItemLayout label={t('config.imageUrls.label')}>
          <ImageUrlsUpload />
        </ConfigItemLayout>
      )}

      {isImageModelAvailable && isSupportSize && (
        <ConfigItemLayout label={t('config.size.label')}>
          <SizeSelect />
        </ConfigItemLayout>
      )}

      {isImageModelAvailable && isSupportQuality && (
        <ConfigItemLayout label={t('config.quality.label')}>
          <QualitySelect />
        </ConfigItemLayout>
      )}

      {isImageModelAvailable && showDimensionControl && <DimensionControlGroup />}

      {isImageModelAvailable && isSupportSteps && (
        <ConfigItemLayout label={t('config.steps.label')}>
          <StepsSliderInput />
        </ConfigItemLayout>
      )}

      {isImageModelAvailable && isSupportCfg && (
        <ConfigItemLayout label={t('config.cfg.label')}>
          <CfgSliderInput />
        </ConfigItemLayout>
      )}

      {isImageModelAvailable && isSupportSeed && (
        <ConfigItemLayout label={t('config.seed.label')}>
          <SeedNumberInput />
        </ConfigItemLayout>
      )}

      {isImageModelAvailable && (
        <ConfigItemLayout label={t('config.imageNum.label')}>
          <ImageNum />
        </ConfigItemLayout>
      )}
    </Flexbox>
  );
});

export default ConfigPanel;
