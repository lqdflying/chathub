'use client';

import {
  RAG_EMBEDDING_PRESETS,
  RagEmbeddingProvider,
  RagProviderStatus,
  RagProviderUpdate,
} from '@lobechat/types';
import { Alert, Button, Icon } from '@lobehub/ui';
import { App, Form, Input, Select, Skeleton, Tag } from 'antd';
import { KeyRound, PlugZap, RotateCcw, Save } from 'lucide-react';
import { memo, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Flexbox } from 'react-layout-kit';

import { FORM_STYLE } from '@/const/layoutTokens';
import { useClientDataSWR } from '@/libs/swr';
import { ragProviderService } from '@/services/ragProvider';
import { useUserStore } from '@/store/user';
import { authSelectors } from '@/store/user/selectors';

type FormValues = RagProviderUpdate;

const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error));

const RagProviderSettings = memo(() => {
  const { t } = useTranslation('setting');
  const { message, modal } = App.useApp();
  const [form] = Form.useForm<FormValues>();
  const scope = useUserStore(authSelectors.currentUserScope);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [reindexing, setReindexing] = useState(false);
  const {
    data: status,
    error: statusError,
    isLoading,
    mutate,
  } = useClientDataSWR<RagProviderStatus>(scope ? ['rag-provider-status', scope] : null, () =>
    ragProviderService.getStatus(),
  );

  const providerOptions = useMemo(
    () =>
      Object.entries(RAG_EMBEDDING_PRESETS).map(([value, preset]) => ({
        label: preset.label,
        value,
      })),
    [],
  );

  useEffect(() => {
    if (!status) return;
    const provider = status.userOverride.provider || status.provider || 'openai';
    form.setFieldsValue({
      apiKey: '',
      baseURL: status.userOverride.baseURL || '',
      model: status.userOverride.model || status.model || RAG_EMBEDDING_PRESETS[provider].model,
      provider,
    });
  }, [form, status]);

  const runReindex = async () => {
    setReindexing(true);
    try {
      const result = await ragProviderService.reindexAll();
      message.success(t('ragProvider.reindexStarted', { count: result.count }));
    } catch (error) {
      message.error(errorMessage(error));
      throw error;
    } finally {
      setReindexing(false);
    }
  };

  const confirmReindex = () => {
    modal.confirm({
      content: t('ragProvider.reindexDescription'),
      okText: t('ragProvider.reindex'),
      onOk: runReindex,
      title: t('ragProvider.reindexTitle'),
    });
  };

  const saveConfig = async () => {
    const values = await form.validateFields();
    setSaving(true);
    try {
      const result = await ragProviderService.update(values);
      await mutate(result.status, { revalidate: false });
      form.setFieldValue('apiKey', '');
      message.success(t('ragProvider.saved'));
      if (result.reindexRequired) confirmReindex();
    } catch (error) {
      message.error(errorMessage(error));
    } finally {
      setSaving(false);
    }
  };

  const testConnection = async () => {
    const values = await form.validateFields();
    setTesting(true);
    try {
      const usesUnchangedEnvironmentConfig =
        status?.source === 'environment' &&
        !values.apiKey &&
        !values.baseURL &&
        values.provider === status.provider &&
        values.model === status.model;
      await ragProviderService.testConnection(usesUnchangedEnvironmentConfig ? undefined : values);
      message.success(t('ragProvider.testSuccess'));
    } catch (error) {
      message.error(errorMessage(error));
    } finally {
      setTesting(false);
    }
  };

  const clearOverride = async () => {
    setSaving(true);
    try {
      const result = await ragProviderService.clearUserOverride();
      await mutate(result.status, { revalidate: false });
      message.success(t('ragProvider.overrideCleared'));
      if (result.reindexRequired) confirmReindex();
    } catch (error) {
      message.error(errorMessage(error));
    } finally {
      setSaving(false);
    }
  };

  if (statusError && !status) {
    return (
      <Alert
        action={
          <Button icon={RotateCcw} onClick={() => mutate()} size={'small'}>
            {t('ragProvider.retry')}
          </Button>
        }
        message={errorMessage(statusError)}
        showIcon
        type={'error'}
      />
    );
  }

  if (isLoading || !status) return <Skeleton active paragraph={{ rows: 6 }} title={false} />;

  return (
    <Flexbox gap={16} style={{ maxWidth: 720, width: '100%' }}>
      <Alert
        message={t(`ragProvider.status.${status.source}`)}
        showIcon
        type={status.configured ? 'info' : 'warning'}
      />
      <Flexbox align={'center'} horizontal justify={'space-between'}>
        <Flexbox align={'center'} gap={8} horizontal>
          <Icon icon={KeyRound} />
          <strong>{t('ragProvider.title')}</strong>
        </Flexbox>
        <Tag color={status.configured ? 'success' : 'warning'}>
          {status.configured ? t('ragProvider.configured') : t('ragProvider.notConfigured')}
        </Tag>
      </Flexbox>
      <Form<FormValues>
        form={form}
        initialValues={{
          baseURL: '',
          model: RAG_EMBEDDING_PRESETS.openai.model,
          provider: 'openai',
        }}
        layout={'vertical'}
        requiredMark={false}
        {...FORM_STYLE}
      >
        <Form.Item label={t('ragProvider.provider')} name={'provider'} rules={[{ required: true }]}>
          <Select
            onChange={(provider: RagEmbeddingProvider) => {
              form.setFieldValue('model', RAG_EMBEDDING_PRESETS[provider].model);
              form.setFieldValue('baseURL', '');
            }}
            options={providerOptions}
          />
        </Form.Item>
        <Form.Item label={t('ragProvider.model')} name={'model'} rules={[{ required: true }]}>
          <Input />
        </Form.Item>
        <Form.Item label={t('ragProvider.baseURL')} name={'baseURL'}>
          <Input placeholder={t('ragProvider.baseURLPlaceholder')} />
        </Form.Item>
        <Form.Item label={t('ragProvider.apiKey')} name={'apiKey'}>
          <Input.Password
            autoComplete={'new-password'}
            placeholder={
              status.userOverride.hasApiKey
                ? t('ragProvider.apiKeySaved')
                : t('ragProvider.apiKeyPlaceholder')
            }
          />
        </Form.Item>
      </Form>
      <Flexbox gap={8} horizontal wrap={'wrap'}>
        <Button icon={PlugZap} loading={testing} onClick={testConnection}>
          {t('ragProvider.test')}
        </Button>
        <Button icon={Save} loading={saving} onClick={saveConfig} type={'primary'}>
          {t('ragProvider.save')}
        </Button>
        {status.userOverride.exists && (
          <Button icon={RotateCcw} onClick={clearOverride}>
            {t('ragProvider.useEnvironment')}
          </Button>
        )}
        {status.configured && (
          <Button disabled={reindexing} loading={reindexing} onClick={confirmReindex}>
            {t('ragProvider.reindex')}
          </Button>
        )}
      </Flexbox>
    </Flexbox>
  );
});

RagProviderSettings.displayName = 'RagProviderSettings';

export default RagProviderSettings;
