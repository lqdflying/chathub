import { Form } from '@lobehub/ui';
import type { FormItemProps } from '@lobehub/ui';
import { Grid, Switch } from 'antd';
import isEqual from 'fast-deep-equal';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useAgentStore } from '@/store/agent';
import { agentChatConfigSelectors, agentSelectors } from '@/store/agent/selectors';
import { aiModelSelectors, useAiInfraStore } from '@/store/aiInfra';

/** MiniMax M2.x — options backed by official OpenAI-compatible API (`reasoning_split`). */
const MinimaxOptions = memo(() => {
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

  const initialValues = useMemo(
    () => ({
      ...config,
      minimaxReasoningSplit: config.minimaxReasoningSplit ?? true,
    }),
    [config],
  );

  const extendParams = modelExtendParams ?? [];
  const items: FormItemProps[] = [];

  if (extendParams.includes('minimaxReasoningSplit')) {
    items.push({
      children: <Switch />,
      desc: (
        <span style={isNarrow ? descNarrow : descWide}>
          {t('extendParams.minimaxReasoningSplit.desc')}
        </span>
      ),
      label: t('extendParams.minimaxReasoningSplit.title'),
      layout: isNarrow ? 'vertical' : 'horizontal',
      minWidth: undefined,
      name: 'minimaxReasoningSplit',
      valuePropName: 'checked',
    });
  }

  return (
    <Form
      initialValues={initialValues}
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

MinimaxOptions.displayName = 'MinimaxOptions';

export default MinimaxOptions;
