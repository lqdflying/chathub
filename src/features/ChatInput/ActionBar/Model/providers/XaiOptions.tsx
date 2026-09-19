import { Form } from '@lobehub/ui';
import type { FormItemProps } from '@lobehub/ui';
import isEqual from 'fast-deep-equal';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useAgentStore } from '@/store/agent';
import { agentChatConfigSelectors, agentSelectors } from '@/store/agent/selectors';
import { aiModelSelectors, useAiInfraStore } from '@/store/aiInfra';

import XaiReasoningEffortSlider from '../XaiReasoningEffortSlider';

/** xAI Grok-only extended options (family-specific reasoning effort). */
const XaiOptions = memo(() => {
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

    if (extendParams.includes('xaiReasoningEffort')) {
      result.push({
        children: <XaiReasoningEffortSlider />,
        label: t('extendParams.xaiReasoningEffort.title'),
        layout: 'vertical',
        minWidth: 0,
        name: 'xaiReasoningEffort',
        style: { minWidth: 0, overflow: 'visible', paddingBottom: 0 },
      });
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
        maxWidth: 292,
        overflowX: 'hidden',
        overflowY: 'auto' as const,
        paddingInline: 12,
        width: 292,
      }}
      variant={'borderless'}
    />
  );
});

XaiOptions.displayName = 'XaiOptions';

export default XaiOptions;
