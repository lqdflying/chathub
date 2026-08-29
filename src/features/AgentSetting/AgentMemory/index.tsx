'use client';

import { Form, type FormGroupItemType } from '@lobehub/ui';
import { App, Form as AntdForm, Select, Switch, TimePicker, Typography } from 'antd';
import { useTheme } from 'antd-style';
import { type Dayjs } from 'dayjs';
import isEqual from 'fast-deep-equal';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { Flexbox } from 'react-layout-kit';

import {
  dayjsToScheduleTime,
  resolveMemoryDreamSchedule,
  scheduleTimeToDayjs,
} from '@/helpers/assistantMemory';
import { FORM_STYLE } from '@/const/layoutTokens';

import { selectors, useStore } from '../store';
import DynamicMemory from './DynamicMemory';
import FixedMemory from './FixedMemory';

const formatTime = (iso: string | undefined) => {
  if (!iso) return undefined;
  const time = new Date(iso);
  return Number.isNaN(time.getTime()) ? undefined : time.toLocaleString();
};

const AgentMemory = memo(() => {
  const { t } = useTranslation('setting');
  const { message } = App.useApp();
  const theme = useTheme();
  const [form] = Form.useForm();
  const updateConfig = useStore((s) => s.setChatConfig);
  const config = useStore(selectors.currentChatConfig, isEqual);
  const rawChatConfig = useStore((s) => s.config.chatConfig);
  const assistantMemoryMeta = useStore((s) => s.config.assistantMemoryMeta);
  const schedule = resolveMemoryDreamSchedule(rawChatConfig);
  const frequency =
    (AntdForm.useWatch('memoryDreamScheduleFrequency', form) as string | undefined) ??
    schedule.frequency;

  const memoryEnabled = config.enableAssistantMemory !== false;
  const lastDreamRun = formatTime(assistantMemoryMeta?.lastRollupAt);
  const lastDreamError = assistantMemoryMeta?.lastError?.message;

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
        label: t('settingChatMemory.memoryDreamSchedule.title'),
        name: 'memoryDreamScheduleFrequency',
        tooltip: { title: t('settingChatMemory.memoryDreamSchedule.tooltip') },
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
      {
        children: (
          <Flexbox gap={2}>
            <Typography.Text type={'secondary'}>
              {lastDreamRun
                ? t('settingChatMemory.memoryDreamSchedule.lastRun', { time: lastDreamRun })
                : t('settingChatMemory.memoryDreamSchedule.lastRunNever')}
            </Typography.Text>
            {!!lastDreamError && (
              <Typography.Text style={{ fontSize: 12 }} type={'danger'}>
                {t('settingChatMemory.memoryDreamSchedule.lastRunError')}
              </Typography.Text>
            )}
          </Flexbox>
        ),
        hidden: !memoryEnabled || frequency === 'off',
        label: t('settingChatMemory.memoryDreamSchedule.lastRunLabel'),
      },
    ],
    title: t('settingChatMemory.memoryGroupTitle'),
  };

  return (
    <Flexbox gap={20}>
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
        items={[memoryGroup]}
        itemsType={'group'}
        onFinish={updateConfig}
        variant={'borderless'}
        {...FORM_STYLE}
      />
    </Flexbox>
  );
});

export default AgentMemory;
