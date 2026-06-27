'use client';

import {
  Form,
  type FormGroupItemType,
  Select,
  SliderWithInput,
} from '@lobehub/ui';
import { Form as AntdForm, Switch } from 'antd';
import isEqual from 'fast-deep-equal';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { FORM_STYLE } from '@/const/layoutTokens';
import ModelSelect from '@/features/ModelSelect';
import { useProviderName } from '@/hooks/useProviderName';

import { selectors, useStore } from '../store';

const AgentModal = memo(() => {
  const { t } = useTranslation('setting');
  const [form] = Form.useForm();
  const config = useStore(selectors.currentAgentConfig, isEqual);

  const enableMaxTokens = AntdForm.useWatch(['chatConfig', 'enableMaxTokens'], form);
  const enableReasoningEffort = AntdForm.useWatch(['chatConfig', 'enableReasoningEffort'], form);

  const updateConfig = useStore((s) => s.setAgentConfig);
  const provider = useStore((s) => s.config.provider);
  const providerName = useProviderName(provider as string);

  const model: FormGroupItemType = {
    children: [
      {
        children: <ModelSelect />,
        desc: t('settingModel.model.desc', { provider: providerName }),
        label: t('settingModel.model.title'),
        name: '_modalConfig',
        tag: 'model',
      },
      {
        children: <Switch />,
        desc: t('settingChat.enableStreaming.desc'),
        label: t('settingChat.enableStreaming.title'),
        layout: 'horizontal',
        minWidth: undefined,
        name: ['chatConfig', 'enableStreaming'],
        valuePropName: 'checked',
      },
      {
        children: <Switch />,
        label: t('settingModel.enableMaxTokens.title'),
        layout: 'horizontal',
        minWidth: undefined,
        name: ['chatConfig', 'enableMaxTokens'],
        valuePropName: 'checked',
      },
      {
        children: (
          <SliderWithInput
            disabled={!enableMaxTokens}
            max={32_000}
            min={0}
            step={100}
            unlimitedInput
          />
        ),
        desc: t('settingModel.maxTokens.desc'),
        divider: false,
        hidden: !enableMaxTokens,
        label: t('settingModel.maxTokens.title'),
        name: ['params', 'max_tokens'],
        tag: 'max_tokens',
      },
      {
        children: <Switch />,
        label: t('settingModel.enableReasoningEffort.title'),
        layout: 'horizontal',
        minWidth: undefined,
        name: ['chatConfig', 'enableReasoningEffort'],
        valuePropName: 'checked',
      },
      {
        children: (
          <Select
            defaultValue="medium"
            options={[
              { label: t('settingModel.reasoningEffort.options.low'), value: 'low' },
              { label: t('settingModel.reasoningEffort.options.medium'), value: 'medium' },
              { label: t('settingModel.reasoningEffort.options.high'), value: 'high' },
            ]}
          />
        ),
        desc: t('settingModel.reasoningEffort.desc'),
        hidden: !enableReasoningEffort,
        label: t('settingModel.reasoningEffort.title'),
        name: ['params', 'reasoning_effort'],
        tag: 'reasoning_effort',
      },
    ],
    title: t('settingModel.title'),
  };

  return (
    <Form
      footer={
        <Form.SubmitFooter
          texts={{
            reset: t('submitFooter.reset'),
            submit: t('settingModel.submit'),
            unSaved: t('submitFooter.unSaved'),
            unSavedWarning: t('submitFooter.unSavedWarning'),
          }}
        />
      }
      form={form}
      initialValues={{
        ...config,
        _modalConfig: {
          model: config.model,
          provider: config.provider,
        },
      }}
      items={[model]}
      itemsType={'group'}
      onFinish={({ _modalConfig, ...rest }) => {
        // 清理 params 中的 undefined 和 null 值，确保禁用的参数被正确移除
        const cleanedRest = { ...rest };
        if (cleanedRest.params) {
          const cleanedParams = { ...cleanedRest.params };
          (Object.keys(cleanedParams) as Array<keyof typeof cleanedParams>).forEach((key) => {
            // 使用 null 作为禁用标记（JSON 可以序列化 null，而 undefined 会被忽略）
            if (cleanedParams[key] === undefined) {
              cleanedParams[key] = null as any;
            }
          });
          cleanedRest.params = cleanedParams as any;
        }

        updateConfig({
          model: _modalConfig?.model,
          provider: _modalConfig?.provider,
          ...cleanedRest,
        });
      }}
      variant={'borderless'}
      {...FORM_STYLE}
    />
  );
});

export default AgentModal;
