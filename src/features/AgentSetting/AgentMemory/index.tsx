'use client';

import { Form, type FormGroupItemType } from '@lobehub/ui';
import { Alert, InputNumber, Select, Switch } from 'antd';
import isEqual from 'fast-deep-equal';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { Flexbox } from 'react-layout-kit';

import { assistanceLevelToChatConfigPatch, type AssistanceLevel } from '@/const/assistanceLevel';
import { FORM_STYLE } from '@/const/layoutTokens';

import { selectors, useStore } from '../store';
import DynamicMemory from './DynamicMemory';
import FixedMemory from './FixedMemory';

const AgentMemory = memo(() => {
  const { t } = useTranslation('setting');
  const [form] = Form.useForm();
  const updateConfig = useStore((s) => s.setChatConfig);
  const config = useStore(selectors.currentChatConfig, isEqual);

  const compactionGroup: FormGroupItemType = {
    children: [
      {
        children: (
          <Select
            options={(['minimal', 'balanced', 'rich'] as AssistanceLevel[]).map((value) => ({
              label: t(`settingChatMemory.assistanceLevel.${value}`),
              value,
            }))}
            popupMatchSelectWidth={false}
          />
        ),
        desc: t('settingChatMemory.assistanceLevel.hint'),
        label: t('settingChatMemory.assistanceLevel.title'),
        name: 'assistanceLevel',
      },
      {
        children: <Switch />,
        desc: t('settingChatMemory.enableTokenThresholdAutoCompact.desc'),
        label: t('settingChatMemory.enableTokenThresholdAutoCompact.title'),
        layout: 'horizontal',
        minWidth: undefined,
        name: 'enableTokenThresholdAutoCompact',
        valuePropName: 'checked',
      },
      {
        children: <InputNumber max={0.99} min={0.5} step={0.01} style={{ width: '100%' }} />,
        desc: t('settingChatMemory.contextCompactThreshold.desc'),
        hidden: !config.enableTokenThresholdAutoCompact,
        label: t('settingChatMemory.contextCompactThreshold.title'),
        name: 'contextCompactThreshold',
      },
      {
        children: <Switch />,
        desc: t('settingChatMemory.enableDailyMemorySummary.desc'),
        label: t('settingChatMemory.enableDailyMemorySummary.title'),
        layout: 'horizontal',
        minWidth: undefined,
        name: 'enableDailyMemorySummary',
        valuePropName: 'checked',
      },
    ],
    title: t('settingChatMemory.compactionGroupTitle'),
  };

  const memoryEnabled = config.enableAssistantMemory !== false;

  const memoryGroup: FormGroupItemType = {
    children: [
      {
        children: <Switch />,
        desc: t('settingChatMemory.enableAssistantMemory.desc'),
        label: t('settingChatMemory.enableAssistantMemory.title'),
        layout: 'horizontal',
        minWidth: undefined,
        name: 'enableAssistantMemory',
        valuePropName: 'checked',
      },
      {
        children: <Switch />,
        desc: t('settingChatMemory.enableUserMemoryArchive.desc'),
        label: t('settingChatMemory.enableUserMemoryArchive.title'),
        layout: 'horizontal',
        minWidth: undefined,
        name: 'enableUserMemoryArchive',
        valuePropName: 'checked',
      },
      {
        children: <Switch />,
        desc: t('settingChatMemory.enablePeriodicAssistantMemoryRollup.desc'),
        hidden: !memoryEnabled,
        label: t('settingChatMemory.enablePeriodicAssistantMemoryRollup.title'),
        layout: 'horizontal',
        minWidth: undefined,
        name: 'enablePeriodicAssistantMemoryRollup',
        valuePropName: 'checked',
      },
    ],
    title: t('settingChatMemory.memoryGroupTitle'),
  };

  return (
    <Flexbox gap={20}>
      <Alert
        description={t('settingChatMemory.guide')}
        message={t('settingChatMemory.guideTitle')}
        showIcon
        type={'info'}
      />
      {memoryEnabled && <FixedMemory />}
      {memoryEnabled && <DynamicMemory />}
      <Form
        footer={
          <Form.SubmitFooter
            texts={{
              reset: t('submitFooter.reset'),
              submit: t('settingChatMemory.submit'),
              unSaved: t('submitFooter.unSaved'),
              unSavedWarning: t('submitFooter.unSavedWarning'),
            }}
          />
        }
        form={form}
        initialValues={config}
        items={[compactionGroup, memoryGroup]}
        itemsType={'group'}
        onFinish={updateConfig}
        onValuesChange={(changed: Partial<typeof config>) => {
          if (Object.prototype.hasOwnProperty.call(changed, 'assistanceLevel')) {
            const level = changed.assistanceLevel as AssistanceLevel | undefined;
            if (level) {
              form.setFieldsValue(assistanceLevelToChatConfigPatch(level));
            }
          }
        }}
        variant={'borderless'}
        {...FORM_STYLE}
      />
    </Flexbox>
  );
});

export default AgentMemory;
