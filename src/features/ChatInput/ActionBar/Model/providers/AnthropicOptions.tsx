import { Form } from '@lobehub/ui';
import type { FormItemProps } from '@lobehub/ui';
import { Form as AntdForm, Grid, Switch } from 'antd';
import isEqual from 'fast-deep-equal';
import Link from 'next/link';
import { memo } from 'react';
import { Trans, useTranslation } from 'react-i18next';

import { isAnthropicAdaptiveThinkingOnlyModel } from '@lobechat/model-runtime';

import { useAgentStore } from '@/store/agent';
import { agentChatConfigSelectors, agentSelectors } from '@/store/agent/selectors';
import { aiModelSelectors, useAiInfraStore } from '@/store/aiInfra';

import ContextCachingSwitch from '../ContextCachingSwitch';
import ReasoningEffortSlider from '../ReasoningEffortSlider';
import ReasoningTokenSlider from '../ReasoningTokenSlider';

/** Claude / Anthropic-only extended options (prompt cache + extended thinking + budget). */
const AnthropicOptions = memo(() => {
  const { t } = useTranslation('chat');
  const [model, provider, updateAgentChatConfig] = useAgentStore((s) => [
    agentSelectors.currentAgentModel(s),
    agentSelectors.currentAgentModelProvider(s),
    s.updateAgentChatConfig,
  ]);

  const config = useAgentStore(agentChatConfigSelectors.currentChatConfig, isEqual);

  const modelExtendParams = useAiInfraStore(aiModelSelectors.modelExtendParams(model, provider));

  const [form] = Form.useForm();
  const enableReasoning = AntdForm.useWatch(['enableReasoning'], form);

  const screens = Grid.useBreakpoint();
  const isNarrow = !screens.sm;

  const descWide = { display: 'inline-block', width: 280 } as const;
  const descNarrow = {
    display: 'block',
    maxWidth: '100%',
    whiteSpace: 'normal',
  } as const;

  const extendParams = modelExtendParams ?? [];

  const baseItems: FormItemProps[] = [];

  if (extendParams.includes('disableContextCaching')) {
    baseItems.push({
      children: <ContextCachingSwitch />,
      desc: (
        <span style={isNarrow ? descNarrow : descWide}>
          <Trans i18nKey={'extendParams.disableContextCaching.desc'} ns={'chat'}>
            单条对话生成成本最高可降低 90%，响应速度提升 4 倍（
            <Link
              href={'https://www.anthropic.com/news/prompt-caching?utm_source=lobechat'}
              rel={'nofollow'}
            >
              了解更多
            </Link>
            ）。开启后将自动禁用历史记录限制
          </Trans>
        </span>
      ),
      label: t('extendParams.disableContextCaching.title'),
      layout: isNarrow ? 'vertical' : 'horizontal',
      minWidth: undefined,
      name: 'disableContextCaching',
    });
  }

  if (extendParams.includes('enableReasoning')) {
    baseItems.push({
      children: <Switch />,
      desc: (
        <span style={isNarrow ? descNarrow : descWide}>
          <Trans i18nKey={'extendParams.enableReasoning.desc'} ns={'chat'}>
            基于 Claude Thinking 机制限制（
            <Link
              href={
                'https://docs.anthropic.com/en/docs/build-with-claude/extended-thinking?utm_source=lobechat#why-thinking-blocks-must-be-preserved'
              }
              rel={'nofollow'}
            >
              了解更多
            </Link>
            ），开启后将自动禁用历史消息数限制
          </Trans>
        </span>
      ),
      label: t('extendParams.enableReasoning.title'),
      layout: isNarrow ? 'vertical' : 'horizontal',
      minWidth: undefined,
      name: 'enableReasoning',
    });
  }

  // Reasoning intensity + token budget are only meaningful when deep thinking is ON
  if (enableReasoning) {
    if (extendParams.includes('reasoningEffort')) {
      baseItems.push({
        children: <ReasoningEffortSlider />,
        label: t('extendParams.reasoningEffort.title'),
        layout: 'vertical',
        minWidth: undefined,
        name: 'reasoningEffort',
        style: { paddingBottom: 0 },
      });
    }

    if (extendParams.includes('reasoningBudgetToken')) {
      baseItems.push({
        children: (
          <ReasoningTokenSlider
            adaptiveOnly={
              provider === 'anthropic' &&
              !!model &&
              isAnthropicAdaptiveThinkingOnlyModel(model)
            }
            model={model}
            provider={provider}
          />
        ),
        label: t('extendParams.reasoningBudgetToken.title'),
        layout: 'vertical',
        minWidth: undefined,
        name: 'reasoningBudgetToken',
        style: { paddingBottom: 0 },
      });
    }
  }

  return (
    <Form
      form={form}
      initialValues={config}
      items={baseItems}
      itemsType={'flat'}
      onValuesChange={async (_, values) => {
        await updateAgentChatConfig(values);
      }}
      size={'small'}
      style={{ fontSize: 12, maxHeight: 360, overflowY: 'auto' as const }}
      variant={'borderless'}
    />
  );
});

AnthropicOptions.displayName = 'AnthropicOptions';

export default AnthropicOptions;
