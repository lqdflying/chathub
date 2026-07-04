'use client';

import { ProviderCombine } from '@lobehub/icons';
import {
  Avatar,
  Form,
  type FormGroupItemType,
  type FormItemProps,
  Icon,
  Tooltip,
} from '@lobehub/ui';
import { useDebounceFn } from 'ahooks';
import { Form as AntdForm, Radio, Select, Skeleton, Switch } from 'antd';
import { createStyles } from 'antd-style';
import { Loader2Icon, LockIcon } from 'lucide-react';
import Link from 'next/link';
import { ReactNode, memo, useCallback, useLayoutEffect, useRef } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { Center, Flexbox } from 'react-layout-kit';
import urlJoin from 'url-join';
import { z } from 'zod';

import { FormInput, FormPassword } from '@/components/FormInput';
import { FORM_STYLE } from '@/const/layoutTokens';
import { AES_GCM_URL, BASE_PROVIDER_DOC_URL } from '@/const/url';
import { isDesktop, isServerMode } from '@/const/version';
import { aiProviderSelectors, useAiInfraStore } from '@/store/aiInfra';
import {
  AiProviderDetailItem,
  AiProviderSourceEnum,
  AiProviderSourceType,
  OPENAI_COMPAT_CACHE_PRESETS,
  type OpenAICompatCacheConfig,
  type OpenAICompatCachePreset,
  type OpenAICompatResponsesTruncationMode,
  type OpenAICompatResponsesVerbosityMode,
  normalizeOpenAICompatCacheConfig,
  normalizeOpenAICompatResponsesParamsConfig,
  openAICompatCachePresetConfig,
  openAICompatResponsesParamsPresetConfig,
} from '@/types/aiProvider';

import { KeyVaultsConfigKey, LLMProviderApiTokenKey, LLMProviderBaseUrlKey } from '../../const';
import { resolveProviderIcon } from '../../utils/resolveProviderIcon';
import Checker, { CheckErrorRender } from './Checker';
import EnableSwitch from './EnableSwitch';
import { SkeletonInput } from './SkeletonInput';
import UpdateProviderInfo from './UpdateProviderInfo';

const useStyles = createStyles(({ css, prefixCls, responsive, token }) => ({
  aceGcm: css`
    padding-block: 0 !important;
    .${prefixCls}-form-item-label {
      display: none;
    }
    .${prefixCls}-form-item-control {
      width: 100%;

      font-size: 12px;
      color: ${token.colorTextSecondary};
      text-align: center;

      opacity: 0.66;

      transition: opacity 0.2s ${token.motionEaseInOut};

      &:hover {
        opacity: 1;
      }
    }
  `,
  form: css`
    .${prefixCls}-form-item-control:has(
        .${prefixCls}-input,
        .${prefixCls}-radio-group,
        .${prefixCls}-select
      ) {
      flex: none;
      width: min(70%, 800px);
      min-width: min(70%, 800px) !important;
    }
    ${responsive.mobile} {
      width: 100%;
      min-width: unset !important;
    }
    .${prefixCls}-select-selection-overflow-item {
      font-size: 12px;
    }
  `,
  help: css`
    border-radius: 50%;

    font-size: 12px;
    font-weight: 500;
    color: ${token.colorTextDescription};

    background: ${token.colorFillTertiary};

    &:hover {
      color: ${token.colorText};
      background: ${token.colorFill};
    }
  `,
  routeSegment: css`
    display: flex !important;
    width: 100%;

    .${prefixCls}-radio-button-wrapper {
      flex: 1;
      min-width: 0;
      text-align: center;
      white-space: nowrap;
    }
  `,
  switchLoading: css`
    width: 44px !important;
    min-width: 44px !important;
    height: 22px !important;
    border-radius: 12px !important;
  `,
}));

export interface ProviderConfigProps extends Omit<AiProviderDetailItem, 'enabled' | 'source'> {
  apiKeyItems?: FormItemProps[];
  apiKeyUrl?: string;
  canDeactivate?: boolean;
  checkErrorRender?: CheckErrorRender;
  className?: string;
  enabled?: boolean;
  extra?: ReactNode;
  hideSwitch?: boolean;
  modelList?: {
    azureDeployName?: boolean;
    notFoundContent?: ReactNode;
    placeholder?: string;
    showModelFetcher?: boolean;
  };
  showAceGcm?: boolean;
  source?: AiProviderSourceType;
  title?: ReactNode;
}

const openAICompatCacheResponseStateMode = (cache: OpenAICompatCacheConfig) =>
  cache.responses?.promptCacheKey === 'derived' ? 'provider' : 'stateless';

const openAICompatCachePresetLabelKey: Record<OpenAICompatCachePreset, string> = {
  'apikl.ai': 'apiklAi',
  custom: 'custom',
  'pptoken.org': 'pptokenOrg',
};

const resolveOpenAICompatValues = (changedValues: any, values: any) => {
  const changedCache = changedValues?.config?.openAICompatCache;
  const changedResponsesParams = changedValues?.config?.openAICompatResponsesParams;
  if (!changedCache && !changedResponsesParams) return values;

  const currentCache = normalizeOpenAICompatCacheConfig(values?.config);
  const currentResponsesParams = normalizeOpenAICompatResponsesParamsConfig(values?.config);
  const presetChanged = !!changedCache && Object.prototype.hasOwnProperty.call(changedCache, 'preset');
  const nextCache = presetChanged
    ? changedCache.preset === 'custom'
      ? { ...currentCache, preset: 'custom' as const }
      : openAICompatCachePresetConfig(changedCache.preset as OpenAICompatCachePreset)
    : { ...currentCache, preset: 'custom' as const };
  const nextResponsesParams = presetChanged
    ? changedCache.preset === 'custom'
      ? currentResponsesParams
      : openAICompatResponsesParamsPresetConfig(changedCache.preset as OpenAICompatCachePreset)
    : currentResponsesParams;

  return {
    ...values,
    config: {
      ...values?.config,
      ...(presetChanged && changedCache.preset !== 'custom' ? { enableResponseApi: true } : {}),
      openAICompatCache: nextCache,
      openAICompatResponsesParams: nextResponsesParams,
      responseStateMode: openAICompatCacheResponseStateMode(nextCache),
    },
  };
};

const ProviderConfig = memo<ProviderConfigProps>(
  ({
    apiKeyItems,
    id,
    settings,
    checkModel,
    logo,
    className,
    checkErrorRender,
    name,
    showAceGcm = true,
    extra,
    source = AiProviderSourceEnum.Builtin,
    apiKeyUrl,
  }) => {
    const {
      proxyUrl,
      showApiKey = true,
      defaultShowBrowserRequest,
      disableBrowserRequest,
      showChecker = true,
      supportResponsesApi,
    } = settings || {};
    const { t } = useTranslation('modelProvider');
    const [form] = Form.useForm();
    const selectedOpenAICompatCachePreset = AntdForm.useWatch(
      ['config', 'openAICompatCache', 'preset'],
      form,
    ) as OpenAICompatCachePreset | undefined;
    const { cx, styles, theme } = useStyles();

    const [
      data,
      updateAiProviderConfig,
      enabled,
      isLoading,
      configUpdating,
      isFetchOnClient,
      isProviderEndpointNotEmpty,
      isProviderApiKeyNotEmpty,
    ] = useAiInfraStore((s) => [
      aiProviderSelectors.activeProviderConfig(s),
      s.updateAiProviderConfig,
      aiProviderSelectors.isProviderEnabled(id)(s),
      aiProviderSelectors.isAiProviderConfigLoading(id)(s),
      aiProviderSelectors.isProviderConfigUpdating(id)(s),
      aiProviderSelectors.isProviderFetchOnClient(id)(s),
      aiProviderSelectors.isActiveProviderEndpointNotEmpty(s),
      aiProviderSelectors.isActiveProviderApiKeyNotEmpty(s),
    ]);

    const supportOpenAICompatCache = supportResponsesApi && id === 'openaicompatible';

    useLayoutEffect(() => {
      if (isLoading) return;

      // set the first time
      form.setFieldsValue(
        supportOpenAICompatCache
          ? {
              ...data,
              config: {
                ...data?.config,
                openAICompatCache: normalizeOpenAICompatCacheConfig(data?.config),
                openAICompatResponsesParams: normalizeOpenAICompatResponsesParamsConfig(
                  data?.config,
                ),
              },
            }
          : data,
      );
    }, [isLoading, id, data, supportOpenAICompatCache]);

    // 标记是否正在进行连接测试
    const isCheckingConnection = useRef(false);

    const handleValueChange = useCallback(
      (...params: Parameters<typeof updateAiProviderConfig>) => {
        // 虽然 debouncedHandleValueChange 早于 onBeforeCheck 执行，
        // 但是由于 debouncedHandleValueChange 因为 debounce 的原因，本来就会晚 500ms 执行
        // 所以 isCheckingConnection.current 这时候已经更新了
        // 测试链接时已经出发一次了 updateAiProviderConfig ， 不应该重复更新
        if (isCheckingConnection.current) return;

        updateAiProviderConfig(...params);
      },
      [updateAiProviderConfig],
    );
    const { run: debouncedHandleValueChange } = useDebounceFn(handleValueChange, {
      wait: 500,
    });

    const isCustom = source === AiProviderSourceEnum.Custom;
    const resolvedOpenAICompatCachePreset = supportOpenAICompatCache
      ? selectedOpenAICompatCachePreset || normalizeOpenAICompatCacheConfig(data?.config).preset
      : 'custom';
    const showOpenAICompatCacheMatrix =
      supportOpenAICompatCache && resolvedOpenAICompatCachePreset === 'custom';
    const responseApiRouteOptions = [
      {
        label: t('providerModels.config.responsesApi.options.chatCompletions'),
        value: false,
      },
      {
        label: t('providerModels.config.responsesApi.options.responses'),
        value: true,
      },
    ];
    const openAICompatCachePresetOptions = OPENAI_COMPAT_CACHE_PRESETS.map((preset) => ({
      label: t(
        `providerModels.config.openAICompatCache.preset.options.${openAICompatCachePresetLabelKey[preset]}`,
      ),
      value: preset,
    }));
    const openAICompatPromptCacheKeyOptions = [
      {
        label: t('providerModels.config.openAICompatCache.promptCacheKey.options.off'),
        value: 'off',
      },
      {
        label: t('providerModels.config.openAICompatCache.promptCacheKey.options.derived'),
        value: 'derived',
      },
    ];
    const openAICompatStoreOptions = [
      {
        label: t('providerModels.config.openAICompatCache.store.options.default'),
        value: 'default',
      },
      {
        label: t('providerModels.config.openAICompatCache.store.options.true'),
        value: 'true',
      },
      {
        label: t('providerModels.config.openAICompatCache.store.options.false'),
        value: 'false',
      },
    ];
    const openAICompatResponsesTruncationOptions: Array<{
      label: string;
      value: OpenAICompatResponsesTruncationMode;
    }> = [
      {
        label: t('providerModels.config.openAICompatResponsesParams.truncation.options.off'),
        value: 'off',
      },
      {
        label: t('providerModels.config.openAICompatResponsesParams.truncation.options.auto'),
        value: 'auto',
      },
      {
        label: t('providerModels.config.openAICompatResponsesParams.truncation.options.disabled'),
        value: 'disabled',
      },
    ];
    const openAICompatResponsesVerbosityOptions: Array<{
      label: string;
      value: OpenAICompatResponsesVerbosityMode;
    }> = [
      {
        label: t('providerModels.config.openAICompatResponsesParams.verbosity.options.off'),
        value: 'off',
      },
      {
        label: t('providerModels.config.openAICompatResponsesParams.verbosity.options.text'),
        value: 'text',
      },
      {
        label: t('providerModels.config.openAICompatResponsesParams.verbosity.options.topLevel'),
        value: 'top-level',
      },
      {
        label: t('providerModels.config.openAICompatResponsesParams.verbosity.options.both'),
        value: 'both',
      },
    ];

    const apiKeyItem: FormItemProps[] = !showApiKey
      ? []
      : (apiKeyItems ?? [
          {
            children: isLoading ? (
              <SkeletonInput />
            ) : (
              <FormPassword
                autoComplete={'new-password'}
                placeholder={t('providerModels.config.apiKey.placeholder', { name })}
                suffix={
                  configUpdating && (
                    <Icon icon={Loader2Icon} spin style={{ color: theme.colorTextTertiary }} />
                  )
                }
              />
            ),
            desc: apiKeyUrl ? (
              <Trans
                i18nKey="providerModels.config.apiKey.descWithUrl"
                ns={'modelProvider'}
                value={{ name }}
              >
                请填写你的 {{ name }} API Key,
                <Link href={apiKeyUrl} target={'_blank'}>
                  点此获取
                </Link>
              </Trans>
            ) : (
              t(`providerModels.config.apiKey.desc`, { name })
            ),
            label: t(`providerModels.config.apiKey.title`),
            name: [KeyVaultsConfigKey, LLMProviderApiTokenKey],
          },
        ]);

    const aceGcmItem: FormItemProps = {
      children: (
        <>
          <Icon icon={LockIcon} style={{ marginRight: 4 }} />
          <Trans i18nKey="providerModels.config.aesGcm" ns={'modelProvider'}>
            您的秘钥与代理地址等将使用
            <Link href={AES_GCM_URL} style={{ marginInline: 4 }} target={'_blank'}>
              AES-GCM
            </Link>
            加密算法进行加密
          </Trans>
        </>
      ),
      className: styles.aceGcm,
      minWidth: undefined,
    };

    const showEndpoint = !!proxyUrl || isCustom;

    const endpointItem = showEndpoint
      ? {
          children: isLoading ? (
            <SkeletonInput />
          ) : (
            <FormInput
              allowClear
              placeholder={
                (!!proxyUrl && proxyUrl?.placeholder) ||
                t('providerModels.config.baseURL.placeholder')
              }
              suffix={
                configUpdating && (
                  <Icon icon={Loader2Icon} spin style={{ color: theme.colorTextTertiary }} />
                )
              }
            />
          ),
          desc: (!!proxyUrl && proxyUrl?.desc) || t('providerModels.config.baseURL.desc'),
          label: (!!proxyUrl && proxyUrl?.title) || t('providerModels.config.baseURL.title'),
          name: [KeyVaultsConfigKey, LLMProviderBaseUrlKey],
          rules: [
            {
              validator: (_: any, value: string) => {
                if (!value) return;

                return z.string().url().safeParse(value).error
                  ? Promise.reject(t('providerModels.config.baseURL.invalid'))
                  : Promise.resolve();
              },
            },
          ],
        }
      : undefined;

    /*
     * Conditions to show Client Fetch Switch
     * 0. is not desktop app
     * 1. provider is not disabled browser request
     * 2. provider show browser request by default
     * 3. Provider allow to edit endpoint and the value of endpoint is not empty
     * 4. There is an apikey provided by user
     */
    const showClientFetch =
      !isDesktop &&
      !disableBrowserRequest &&
      (defaultShowBrowserRequest ||
        (showEndpoint && isProviderEndpointNotEmpty) ||
        (showApiKey && isProviderApiKeyNotEmpty));
    const clientFetchItem = showClientFetch && {
      children: isLoading ? (
        <Skeleton.Button active className={styles.switchLoading} />
      ) : (
        <Switch checked={isFetchOnClient} disabled={configUpdating} />
      ),
      desc: t('providerModels.config.fetchOnClient.desc'),
      label: t('providerModels.config.fetchOnClient.title'),
      minWidth: undefined,
      name: 'fetchOnClient',
    };

    const openAICompatCacheItems: FormItemProps[] = supportOpenAICompatCache
      ? [
          {
            children: isLoading ? (
              <Skeleton.Button active />
            ) : (
              <Select disabled={configUpdating} options={openAICompatCachePresetOptions} />
            ),
            desc: t('providerModels.config.openAICompatCache.preset.desc'),
            label: t('providerModels.config.openAICompatCache.preset.title'),
            name: ['config', 'openAICompatCache', 'preset'],
          },
          ...(showOpenAICompatCacheMatrix
            ? [
                {
                  children: isLoading ? (
                    <Skeleton.Button active />
                  ) : (
                    <Switch loading={configUpdating} />
                  ),
                  desc: t('providerModels.config.openAICompatCache.chatPromptCacheKey.desc'),
                  getValueFromEvent: (checked: boolean) => checked,
                  getValueProps: (value?: boolean) => ({ checked: !!value }),
                  label: t('providerModels.config.openAICompatCache.chatPromptCacheKey.title'),
                  minWidth: undefined,
                  name: ['config', 'openAICompatCache', 'chat', 'promptCacheKey'],
                },
                {
                  children: isLoading ? (
                    <Skeleton.Button active />
                  ) : (
                    <Switch loading={configUpdating} />
                  ),
                  desc: t('providerModels.config.openAICompatCache.chatSessionHeader.desc'),
                  getValueFromEvent: (checked: boolean) => checked,
                  getValueProps: (value?: boolean) => ({ checked: !!value }),
                  label: t('providerModels.config.openAICompatCache.chatSessionHeader.title'),
                  minWidth: undefined,
                  name: ['config', 'openAICompatCache', 'chat', 'sessionHeader'],
                },
                {
                  children: isLoading ? (
                    <Skeleton.Button active />
                  ) : (
                    <Select disabled={configUpdating} options={openAICompatPromptCacheKeyOptions} />
                  ),
                  desc: t('providerModels.config.openAICompatCache.responsesPromptCacheKey.desc'),
                  label: t('providerModels.config.openAICompatCache.responsesPromptCacheKey.title'),
                  name: ['config', 'openAICompatCache', 'responses', 'promptCacheKey'],
                },
                {
                  children: isLoading ? (
                    <Skeleton.Button active />
                  ) : (
                    <Switch loading={configUpdating} />
                  ),
                  desc: t('providerModels.config.openAICompatCache.responsesSessionHeader.desc'),
                  getValueFromEvent: (checked: boolean) => checked,
                  getValueProps: (value?: boolean) => ({ checked: !!value }),
                  label: t('providerModels.config.openAICompatCache.responsesSessionHeader.title'),
                  minWidth: undefined,
                  name: ['config', 'openAICompatCache', 'responses', 'sessionHeader'],
                },
                {
                  children: isLoading ? (
                    <Skeleton.Button active />
                  ) : (
                    <Select disabled={configUpdating} options={openAICompatStoreOptions} />
                  ),
                  desc: t('providerModels.config.openAICompatCache.responsesStore.desc'),
                  label: t('providerModels.config.openAICompatCache.responsesStore.title'),
                  name: ['config', 'openAICompatCache', 'responses', 'store'],
                },
                {
                  children: isLoading ? (
                    <Skeleton.Button active />
                  ) : (
                    <Switch loading={configUpdating} />
                  ),
                  desc: t('providerModels.config.openAICompatResponsesParams.maxTokens.desc'),
                  getValueFromEvent: (checked: boolean) => checked,
                  getValueProps: (value?: boolean) => ({ checked: !!value }),
                  label: t('providerModels.config.openAICompatResponsesParams.maxTokens.title'),
                  minWidth: undefined,
                  name: ['config', 'openAICompatResponsesParams', 'maxTokens'],
                },
                {
                  children: isLoading ? (
                    <Skeleton.Button active />
                  ) : (
                    <Switch loading={configUpdating} />
                  ),
                  desc: t('providerModels.config.openAICompatResponsesParams.maxOutputTokens.desc'),
                  getValueFromEvent: (checked: boolean) => checked,
                  getValueProps: (value?: boolean) => ({ checked: !!value }),
                  label: t(
                    'providerModels.config.openAICompatResponsesParams.maxOutputTokens.title',
                  ),
                  minWidth: undefined,
                  name: ['config', 'openAICompatResponsesParams', 'maxOutputTokens'],
                },
                {
                  children: isLoading ? (
                    <Skeleton.Button active />
                  ) : (
                    <Select
                      disabled={configUpdating}
                      options={openAICompatResponsesTruncationOptions}
                    />
                  ),
                  desc: t('providerModels.config.openAICompatResponsesParams.truncation.desc'),
                  label: t('providerModels.config.openAICompatResponsesParams.truncation.title'),
                  name: ['config', 'openAICompatResponsesParams', 'truncation'],
                },
                {
                  children: isLoading ? (
                    <Skeleton.Button active />
                  ) : (
                    <Select
                      disabled={configUpdating}
                      options={openAICompatResponsesVerbosityOptions}
                    />
                  ),
                  desc: t('providerModels.config.openAICompatResponsesParams.verbosity.desc'),
                  label: t('providerModels.config.openAICompatResponsesParams.verbosity.title'),
                  name: ['config', 'openAICompatResponsesParams', 'verbosity'],
                },
              ]
            : []),
        ]
      : [];

    const configItems = [
      ...apiKeyItem,
      endpointItem,
      supportResponsesApi
        ? {
            children: isLoading ? (
              <Skeleton.Button active />
            ) : (
              <Radio.Group
                buttonStyle="solid"
                className={styles.routeSegment}
                disabled={configUpdating}
                optionType="button"
                options={responseApiRouteOptions}
              />
            ),
            desc: t('providerModels.config.responsesApi.desc'),
            getValueProps: (value?: boolean) => ({ value: !!value }),
            label: t('providerModels.config.responsesApi.title'),
            name: ['config', 'enableResponseApi'],
          }
        : undefined,
      ...openAICompatCacheItems,
      clientFetchItem,
      showChecker
        ? {
            children: isLoading ? (
              <Skeleton.Button active />
            ) : (
              <Checker
                checkErrorRender={checkErrorRender}
                model={data?.checkModel || checkModel!}
                onAfterCheck={async () => {
                  // 重置连接测试状态，允许后续的 onValuesChange 更新
                  isCheckingConnection.current = false;
                }}
                onBeforeCheck={async () => {
                  // 设置连接测试状态，阻止 onValuesChange 的重复请求
                  isCheckingConnection.current = true;
                  // 主动保存表单最新值，确保 fetchAiProviderRuntimeState 获取最新数据
                  await updateAiProviderConfig(id, form.getFieldsValue());
                }}
                provider={id}
              />
            ),
            desc: t('providerModels.config.checker.desc'),
            label: t('providerModels.config.checker.title'),
            minWidth: undefined,
          }
        : undefined,
      showAceGcm && isServerMode && aceGcmItem,
    ].filter(Boolean) as FormItemProps[];

    const logoUrl = data?.logo ?? logo;
    const model: FormGroupItemType = {
      children: configItems,

      defaultActive: true,

      extra: (
        <Flexbox align={'center'} gap={8} horizontal>
          {extra}

          {isCustom && <UpdateProviderInfo />}
          <EnableSwitch id={id} />
        </Flexbox>
      ),
      title: (
        <Flexbox
          align={'center'}
          gap={4}
          horizontal
          style={{
            height: 24,
            maxHeight: 24,
            ...(enabled ? {} : { filter: 'grayscale(100%)', maxHeight: 24, opacity: 0.66 }),
          }}
        >
          {isCustom ? (
            <Flexbox align={'center'} gap={8} horizontal>
              {logoUrl ? (
                <Avatar avatar={logoUrl} shape={'circle'} size={32} title={name || id} />
              ) : (
                <ProviderCombine provider={'not-exist-provider'} size={24} />
              )}
              {name}
            </Flexbox>
          ) : (
            <>
              <ProviderCombine provider={resolveProviderIcon(id)} size={24} />
              <Tooltip title={t('providerModels.config.helpDoc')}>
                <Link
                  href={urlJoin(BASE_PROVIDER_DOC_URL, id)}
                  onClick={(e) => e.stopPropagation()}
                  target={'_blank'}
                >
                  <Center className={styles.help} height={20} width={20}>
                    ?
                  </Center>
                </Link>
              </Tooltip>
            </>
          )}
        </Flexbox>
      ),
    };

    return (
      <Form
        className={cx(styles.form, className)}
        form={form}
        items={[model]}
        onValuesChange={(changedValues, values) => {
          const nextValues = supportOpenAICompatCache
            ? resolveOpenAICompatValues(changedValues, values)
            : values;

          if (nextValues !== values) form.setFieldsValue(nextValues);

          debouncedHandleValueChange(id, nextValues);
        }}
        variant={'borderless'}
        {...FORM_STYLE}
      />
    );
  },
);

export default ProviderConfig;

export { SkeletonInput } from './SkeletonInput';
