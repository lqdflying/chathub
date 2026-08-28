'use client';

import { Form, type FormGroupItemType } from '@lobehub/ui';
import { Alert, App, Form as AntdForm, InputNumber, Select, Switch, TimePicker } from 'antd';
import { useTheme } from 'antd-style';
import { type Dayjs } from 'dayjs';
import isEqual from 'fast-deep-equal';
import { memo, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Flexbox } from 'react-layout-kit';

import InfoTooltip from '@/components/InfoTooltip';
import { assistanceLevelToChatConfigPatch, type AssistanceLevel } from '@/const/assistanceLevel';
import { FORM_STYLE } from '@/const/layoutTokens';
import {
  dayjsToScheduleTime,
  resolveMemoryDreamSchedule,
  scheduleTimeToDayjs,
} from '@/helpers/assistantMemory';

import { selectors, useStore } from '../store';
import DynamicMemory from './DynamicMemory';
import FixedMemory from './FixedMemory';

const withTooltip = (title: string, tooltip: string): ReactNode => (
  <Flexbox align={'center'} gap={6} horizontal>
    {title}
    <InfoTooltip title={tooltip} />
  </Flexbox>
);

const AgentMemory = memo(() => {
  const { t } = useTranslation('setting');
  const { message } = App.useApp();
  const theme = useTheme();
  const [form] = Form.useForm();
  const updateConfig = useStore((s) => s.setChatConfig);
  const config = useStore(selectors.currentChatConfig, isEqual);
  const rawChatConfig = useStore((s) => s.config.chatConfig);
  const schedule = resolveMemoryDreamSchedule(rawChatConfig);
  const frequency =
    (AntdForm.useWatch('memoryDreamScheduleFrequency', form) as string | undefined) ??
    schedule.frequency;

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
        label: withTooltip(
          t('settingChatMemory.assistanceLevel.title'),
          t('settingChatMemory.assistanceLevel.tooltip'),
        ),
        name: 'assistanceLevel',
      },
      {
        children: <Switch />,
        desc: t('settingChatMemory.enableTokenThresholdAutoCompact.desc'),
        label: withTooltip(
          t('settingChatMemory.enableTokenThresholdAutoCompact.title'),
          t('settingChatMemory.enableTokenThresholdAutoCompact.tooltip'),
        ),
        layout: 'horizontal',
        minWidth: undefined,
        name: 'enableTokenThresholdAutoCompact',
        valuePropName: 'checked',
      },
      {
        children: <InputNumber max={0.99} min={0.5} step={0.01} style={{ width: '100%' }} />,
        desc: t('settingChatMemory.contextCompactThreshold.desc'),
        hidden: !config.enableTokenThresholdAutoCompact,
        label: withTooltip(
          t('settingChatMemory.contextCompactThreshold.title'),
          t('settingChatMemory.contextCompactThreshold.tooltip'),
        ),
        name: 'contextCompactThreshold',
      },
    ],
    title: t('settingChatMemory.compactionGroupTitle'),
  };

  const memoryEnabled = config.enableAssistantMemory !== false;

  const memoryGroup: FormGroupItemType = {
    children: [
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
        children: (
          <Select
            options={(['off', 'daily', 'weekly'] as const).map((value) => ({
              label: t(`settingChatMemory.memoryDreamSchedule.frequency.${value}`),
              value,
            }))}
            popupMatchSelectWidth={false}
            style={{ minWidth: 160 }}
          />
        ),
        desc: t('settingChatMemory.memoryDreamSchedule.frequency.desc'),
        hidden: !memoryEnabled,
        label: withTooltip(
          t('settingChatMemory.memoryDreamSchedule.title'),
          t('settingChatMemory.memoryDreamSchedule.tooltip'),
        ),
        name: 'memoryDreamScheduleFrequency',
      },
      {
        children: <TimePicker format={'HH:mm'} needConfirm={false} showNow={false} />,
        desc: t('settingChatMemory.memoryDreamSchedule.time.desc'),
        getValueFromEvent: (value: Dayjs | null) => dayjsToScheduleTime(value),
        getValueProps: (value: string | undefined) => ({
          value: scheduleTimeToDayjs(value),
        }),
        hidden: !memoryEnabled || frequency === 'off',
        label: t('settingChatMemory.memoryDreamSchedule.time.title'),
        name: 'memoryDreamScheduleTime',
      },
      {
        children: (
          <Select
            options={[0, 1, 2, 3, 4, 5, 6].map((value) => ({
              label: t(`settingChatMemory.memoryDreamSchedule.weekday.${value}`),
              value,
            }))}
            popupMatchSelectWidth={false}
            style={{ minWidth: 160 }}
          />
        ),
        desc: t('settingChatMemory.memoryDreamSchedule.weekday.desc'),
        hidden: !memoryEnabled || frequency !== 'weekly',
        label: t('settingChatMemory.memoryDreamSchedule.weekday.title'),
        name: 'memoryDreamScheduleWeekday',
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
      <Flexbox
        align={'center'}
        gap={16}
        horizontal
        justify={'space-between'}
        paddingInline={4}
      >
        <Flexbox gap={4}>
          <div style={{ fontSize: 16, fontWeight: 600 }}>
            {t('settingChatMemory.enableAssistantMemory.title')}
          </div>
          <div style={{ color: theme.colorTextDescription, fontSize: 12 }}>
            {t('settingChatMemory.enableAssistantMemory.desc')}
          </div>
        </Flexbox>
        <Switch
          checked={memoryEnabled}
          onChange={(checked) => {
            Promise.resolve(updateConfig({ enableAssistantMemory: checked })).catch((error) => {
              message.error(
                t('settingChatMemory.saveFailedWithReason', {
                  reason: (error as Error)?.message || String(error ?? 'unknown error'),
                }),
              );
            });
          }}
        />
      </Flexbox>
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
        initialValues={{
          ...config,
          memoryDreamScheduleFrequency: schedule.frequency,
          memoryDreamScheduleTime: schedule.time,
          memoryDreamScheduleWeekday: schedule.weekday,
        }}
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
