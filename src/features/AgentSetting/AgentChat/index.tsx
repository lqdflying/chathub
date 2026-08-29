'use client';

import { Form, type FormGroupItemType, ImageSelect, SliderWithInput, TextArea } from '@lobehub/ui';
import { InputNumber, Select, Switch } from 'antd';
import { useThemeMode } from 'antd-style';
import isEqual from 'fast-deep-equal';
import { LayoutList, MessagesSquare } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { Flexbox } from 'react-layout-kit';

import { withTooltip } from '@/components/FormLabelWithTooltip';
import { assistanceLevelToChatConfigPatch, type AssistanceLevel } from '@/const/assistanceLevel';
import { FORM_STYLE } from '@/const/layoutTokens';
import { imageUrl } from '@/const/url';

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
        tooltip: {
          title: t('settingChat.enableAutoCreateTopic.tooltip'),
          trigger: ['hover', 'click'],
        },
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
        tooltip: {
          title: t('settingChat.enableHistoryCount.tooltip'),
          trigger: ['hover', 'click'],
        },
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
        tooltip: {
          title: t('settingChat.enableCompressHistory.tooltip'),
          trigger: ['hover', 'click'],
        },
        valuePropName: 'checked',
      },
    ],
    title: t('settingChat.title'),
  };

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
        label: t('settingChatMemory.enableTokenThresholdAutoCompact.title'),
        layout: 'horizontal',
        minWidth: undefined,
        name: 'enableTokenThresholdAutoCompact',
        tooltip: {
          title: t('settingChatMemory.enableTokenThresholdAutoCompact.tooltip'),
          trigger: ['hover', 'click'],
        },
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
        items={[chat, compactionGroup]}
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

export default AgentChat;
