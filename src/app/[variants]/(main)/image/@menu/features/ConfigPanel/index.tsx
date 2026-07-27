'use client';

import { Alert, Button, Text } from '@lobehub/ui';
import { useTheme } from 'antd-style';
import { RefreshCw } from 'lucide-react';
import React, { ReactNode, memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
  const theme = useTheme();

  // All hooks must be called before any early returns
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [isScrollable, setIsScrollable] = useState(false);
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
  const hasProviderRuntimeFailure =
    !!currentUserScope && runtimeStateInitializationFailure?.scope === currentUserScope;
  const hasUnresolvedAuthenticatedScope = isAuthLoaded && !!isLogin && !currentUserScope;
  const hasBootstrapFailure =
    hasUserStateFailure || hasProviderRuntimeFailure || hasUnresolvedAuthenticatedScope;
  const isRetryingCurrentScope =
    !!currentUserScope && retryingScope === currentUserScope;

  const handleRetry = useCallback(async () => {
    if (
      !currentUserScope ||
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
    hasProviderRuntimeFailure,
    hasUserStateFailure,
    refreshAiProviderRuntimeState,
    refreshUserState,
  ]);

  // Check if content exceeds container height and needs scrolling
  const checkScrollable = useCallback(() => {
    const container = scrollContainerRef.current;
    if (container) {
      const hasScrollbar = container.scrollHeight > container.clientHeight;
      setIsScrollable(hasScrollbar);
    }
  }, []);

  // Re-check when content changes
  useEffect(() => {
    checkScrollable();
  }, [
    checkScrollable,
    isSupportImageUrl,
    isSupportSize,
    isSupportQuality,
    isSupportSeed,
    isSupportSteps,
    isSupportCfg,
    isSupportImageUrls,
    showDimensionControl,
  ]);

  // Setup observers for container changes
  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    // Initial check
    checkScrollable();

    // Use ResizeObserver for container size changes
    const resizeObserver = new ResizeObserver(checkScrollable);
    resizeObserver.observe(container);

    // Use MutationObserver for content changes
    const mutationObserver = new MutationObserver(checkScrollable);
    mutationObserver.observe(container, { childList: true, subtree: true });

    return () => {
      resizeObserver.disconnect();
      mutationObserver.disconnect();
    };
  }, [checkScrollable]);

  // Memoize sticky styles to prevent unnecessary re-renders
  const stickyStyles = useMemo(
    () => ({
      bottom: 0,
      position: 'sticky' as const,
      zIndex: 1,
      ...(isScrollable && {
        backgroundColor: theme.colorBgContainer,
        borderTop: `1px solid ${theme.colorBorder}`,
        // Use negative margin to extend background to container edges
        marginLeft: -12,
        marginRight: -12,
        marginTop: 20,
        // Add back internal padding
        paddingLeft: 12,
        paddingRight: 12,
      }),
    }),
    [isScrollable, theme.colorBgContainer, theme.colorBorder],
  );

  if (isRetryingCurrentScope) {
    return <ImageConfigSkeleton />;
  }

  if (hasBootstrapFailure) {
    return (
      <Center height={'100%'} padding={16} width={'100%'}>
        <Alert
          action={
            !hasUnresolvedAuthenticatedScope && (
              <Button icon={RefreshCw} onClick={handleRetry} size={'small'} type={'primary'}>
                {t('config.bootstrapFailure.retry')}
              </Button>
            )
          }
          description={t(
            hasUnresolvedAuthenticatedScope
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
    <Flexbox
      gap={32}
      padding="12px 12px 0 12px"
      ref={scrollContainerRef}
      style={{ height: '100%', overflow: 'auto' }}
    >
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
        <Flexbox padding="12px 0" style={stickyStyles}>
          <ConfigItemLayout label={t('config.imageNum.label')}>
            <ImageNum />
          </ConfigItemLayout>
        </Flexbox>
      )}
    </Flexbox>
  );
});

export default ConfigPanel;
