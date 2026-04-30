import { Form } from '@lobehub/ui';
import type { FormItemProps } from '@lobehub/ui';
import { Grid, Switch } from 'antd';
import isEqual from 'fast-deep-equal';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useAgentStore } from '@/store/agent';
import { agentChatConfigSelectors, agentSelectors } from '@/store/agent/selectors';
import { aiModelSelectors, useAiInfraStore } from '@/store/aiInfra';

/** DeepSeek-only extended options (thinking + reasoning effort). */
const DeepSeekOptions = memo(() => {
  const { t } = useTranslation('chat');
  const [model, provider, updateAgentChatConfig] = useAgentStore((s) => [
    agentSelectors.currentAgentModel(s),
    agentSelectors.currentAgentModelProvider(s),
    s.updateAgentChatConfig,
  ]);

  const config = useAgentStore(agentChatConfigSelectors.currentChatConfig, isEqual);

  const modelExtendParams = useAiInfraStore(aiModelSelectors.modelExtendParams(model, provider));

  const screens = Grid.useBreakpoint();
  const isNarrow = !screens.sm;

  const descWide = { display: 'inline-block', width: 280 } as const;
  const descNarrow = {
    display: 'block',
    maxWidth: '100%',
    whiteSpace: 'normal',
  } as const;

  const extendParams = modelExtendParams ?? [];
  const items: FormItemProps[] = [];

  if (extendParams.includes('enableReasoning')) {
    items.push({
      children: <Switch />,
      desc: (
        <span style={isNarrow ? descNarrow : descWide}>
          {t('extendParams.deepSeekReasoning.desc')}
        </span>
      ),
      label: t('extendParams.deepSeekReasoning.title'),
      layout: isNarrow ? 'vertical' : 'horizontal',
      minWidth: undefined,
      name: 'enableReasoning',
    });
  }

  if (extendParams.includes('reasoningEffort')) {
    items.push({
      children: <Switch />,
      desc: (
        <span style={isNarrow ? descNarrow : descWide}>
          {t('extendParams.deepSeekReasoningEffort.desc')}
        </span>
      ),
      label: t('extendParams.deepSeekReasoningEffort.title'),
      layout: isNarrow ? 'vertical' : 'horizontal',
      minWidth: undefined,
      name: 'enableReasoningEffort',
    });
  }

  return (
    <Form
      initialValues={config}
      items={items}
      itemsType={'flat'}
      onValuesChange={async (_, values) => {
        await updateAgentChatConfig(values);
      }}
      size={'small'}
      style={{ fontSize: 12 }}
      variant={'borderless'}
    />
  );
});

DeepSeekOptions.displayName = 'DeepSeekOptions';

export default DeepSeekOptions;
