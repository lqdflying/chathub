'use client';

import { Form, type FormGroupItemType, ImageSelect, SliderWithInput, TextArea } from '@lobehub/ui';
import { InputNumber, Select, Switch } from 'antd';
import { useThemeMode } from 'antd-style';
import isEqual from 'fast-deep-equal';
import { LayoutList, MessagesSquare } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { Flexbox } from 'react-layout-kit';

import { assistanceLevelToChatConfigPatch, type AssistanceLevel } from '@/const/assistanceLevel';
import { FORM_STYLE } from '@/const/layoutTokens';
import { imageUrl } from '@/const/url';

import AgentMemoryPreview from './AgentMemoryPreview';
import { selectors, useStore } from '../store';

const AgentChat = memo(() => {
  const { t } = useTranslation('setting');
  const [form] = Form.useForm();
  const { isDarkMode } = useThemeMode();
  const updateConfig = useStore((s) => s.setChatConfig);
  const config = useStore(selectors.currentChatConfig, isEqual);

  const chat: FormGroupItemType = {
    children: [
      {
        children: (
          <ImageSelect
            height={86}
            options={[
              {
                icon: MessagesSquare,
                img: imageUrl(`chatmode_chat_${isDarkMode ? 'dark' : 'light'}.webp`),
                label: t('settingChat.chatStyleType.type.chat'),
                value: 'chat',
              },
              {
                icon: LayoutList,
                img: imageUrl(`chatmode_docs_${isDarkMode ? 'dark' : 'light'}.webp`),
                label: t('settingChat.chatStyleType.type.docs'),
                value: 'docs',
              },
            ]}
            style={{
              marginRight: 2,
            }}
            unoptimized={false}
            width={144}
          />
        ),
        label: t('settingChat.chatStyleType.title'),
        minWidth: undefined,
        name: 'displayMode',
      },
      {
        children: <TextArea placeholder={t('settingChat.inputTemplate.placeholder')} />,
        desc: t('settingChat.inputTemplate.desc'),
        label: t('settingChat.inputTemplate.title'),
        name: 'inputTemplate',
      },
      {
        children: <Switch />,
        desc: t('settingChat.enableAutoCreateTopic.desc'),
        label: t('settingChat.enableAutoCreateTopic.title'),
        layout: 'horizontal',
        minWidth: undefined,
        name: 'enableAutoCreateTopic',
        valuePropName: 'checked',
      },
      {
        children: <SliderWithInput max={8} min={0} unlimitedInput={true} />,
        desc: t('settingChat.autoCreateTopicThreshold.desc'),
        divider: false,
        hidden: !config.enableAutoCreateTopic,
        label: t('settingChat.autoCreateTopicThreshold.title'),
        name: 'autoCreateTopicThreshold',
      },
      {
        children: <Switch />,
        label: t('settingChat.enableHistoryCount.title'),
        layout: 'horizontal',
        minWidth: undefined,
        name: 'enableHistoryCount',
        valuePropName: 'checked',
      },
      {
        children: <SliderWithInput max={20} min={0} unlimitedInput={true} />,
        desc: t('settingChat.historyCount.desc'),
        divider: false,
        hidden: !config.enableHistoryCount,
        label: t('settingChat.historyCount.title'),
        name: 'historyCount',
      },
      {
        children: <Switch />,
        hidden: !config.enableHistoryCount,
        label: t('settingChat.enableCompressHistory.title'),
        layout: 'horizontal',
        minWidth: undefined,
        name: 'enableCompressHistory',
        valuePropName: 'checked',
      },
    ],
    title: t('settingChat.title'),
  };

  const memory: FormGroupItemType = {
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
      {
        children: <Switch />,
        desc: t('settingChatMemory.enableUserMemoryArchive.desc'),
        label: t('settingChatMemory.enableUserMemoryArchive.title'),
        layout: 'horizontal',
        minWidth: undefined,
        name: 'enableUserMemoryArchive',
        valuePropName: 'checked',
      },
    ],
    title: t('settingChatMemory.groupTitle'),
  };

  return (
    <Flexbox gap={20}>
      <Form
        footer={
          <Form.SubmitFooter
            texts={{
              reset: t('submitFooter.reset'),
              submit: t('settingChat.submit'),
              unSaved: t('submitFooter.unSaved'),
              unSavedWarning: t('submitFooter.unSavedWarning'),
            }}
          />
        }
        form={form}
        initialValues={config}
        items={[chat, memory]}
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
      <Flexbox gap={8}>
        <div style={{ fontSize: 14, fontWeight: 600 }}>{t('settingChatMemory.previewSection')}</div>
        <AgentMemoryPreview />
      </Flexbox>
    </Flexbox>
  );
});

export default AgentChat;
