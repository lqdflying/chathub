import { Form } from '@lobehub/ui';
import type { FormItemProps } from '@lobehub/ui';
import isEqual from 'fast-deep-equal';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useAgentStore } from '@/store/agent';
import { agentChatConfigSelectors, agentSelectors } from '@/store/agent/selectors';
import { aiModelSelectors, useAiInfraStore } from '@/store/aiInfra';

import GPT5ReasoningEffortSlider from '../GPT5ReasoningEffortSlider';
import ReasoningEffortSlider from '../ReasoningEffortSlider';
import TextVerbositySlider from '../TextVerbositySlider';

/** OpenAI-only extended options (Responses API reasoning + GPT-5 verbosity). */
const OpenAIOptions = memo(() => {
  const { t } = useTranslation('chat');

  const [model, provider, updateAgentChatConfig] = useAgentStore((s) => [
    agentSelectors.currentAgentModel(s),
    agentSelectors.currentAgentModelProvider(s),
    s.updateAgentChatConfig,
  ]);

  const config = useAgentStore(agentChatConfigSelectors.currentChatConfig, isEqual);

  const modelExtendParams = useAiInfraStore(aiModelSelectors.modelExtendParams(model, provider));

  const extendParams = modelExtendParams ?? [];

  const items = useMemo(() => {
    const result: FormItemProps[] = [];

    for (const param of extendParams) {
      if (param === 'reasoningEffort') {
        result.push({
          children: <ReasoningEffortSlider />,
          label: t('extendParams.reasoningEffort.title'),
          layout: 'vertical',
          minWidth: 0,
          name: 'reasoningEffort',
          style: { minWidth: 0, overflow: 'hidden', paddingBottom: 0 },
        });
      }
      if (param === 'gpt5ReasoningEffort') {
        result.push({
          children: <GPT5ReasoningEffortSlider />,
          label: t('extendParams.reasoningEffort.title'),
          layout: 'vertical',
          minWidth: 0,
          name: 'gpt5ReasoningEffort',
          style: { minWidth: 0, overflow: 'hidden', paddingBottom: 0 },
        });
      }
      if (param === 'textVerbosity') {
        result.push({
          children: <TextVerbositySlider />,
          label: t('extendParams.textVerbosity.title'),
          layout: 'vertical',
          minWidth: 0,
          name: 'textVerbosity',
          style: { minWidth: 0, overflow: 'hidden', paddingBottom: 0 },
        });
      }
    }

    return result;
  }, [extendParams, t]);

  return (
    <Form
      initialValues={config}
      items={items}
      itemsType={'flat'}
      onValuesChange={async (_, values) => {
        await updateAgentChatConfig(values);
      }}
      size={'small'}
      style={{
        boxSizing: 'border-box',
        fontSize: 12,
        maxHeight: 320,
        maxWidth: 288,
        overflowX: 'hidden',
        overflowY: 'auto' as const,
        paddingInline: 6,
        width: 288,
      }}
      variant={'borderless'}
    />
  );
});

OpenAIOptions.displayName = 'OpenAIOptions';

export default OpenAIOptions;
