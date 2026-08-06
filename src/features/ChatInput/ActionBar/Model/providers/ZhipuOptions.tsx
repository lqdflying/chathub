import { Form } from '@lobehub/ui';
import type { FormItemProps } from '@lobehub/ui';
import { Grid, Segmented, Switch } from 'antd';
import isEqual from 'fast-deep-equal';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useAgentStore } from '@/store/agent';
import { agentChatConfigSelectors, agentSelectors } from '@/store/agent/selectors';
import { aiModelSelectors, useAiInfraStore } from '@/store/aiInfra';

const descWide = { display: 'inline-block', width: 280 } as const;
const descNarrow = {
  display: 'block',
  maxWidth: '100%',
  whiteSpace: 'normal',
} as const;

/** Zhipu GLM-5.2 — extended options (thinking toggle, reasoning_effort, Preserved Thinking). */
const ZhipuOptions = memo(() => {
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

  const extendParams = modelExtendParams ?? [];
  const items = useMemo(() => {
    const result: FormItemProps[] = [];

    if (extendParams.includes('enableReasoning')) {
      result.push({
        children: <Switch />,
        desc: (
          <span style={isNarrow ? descNarrow : descWide}>
            {t('extendParams.zhipuReasoning.desc')}
          </span>
        ),
        label: t('extendParams.zhipuReasoning.title'),
        layout: isNarrow ? 'vertical' : 'horizontal',
        minWidth: undefined,
        name: 'enableReasoning',
      });
    }

    // reasoning_effort only applies when thinking is on; hide otherwise so users
    // cannot toggle an option that the runtime would drop anyway.
    if (extendParams.includes('zhipuReasoningEffort') && config.enableReasoning) {
      result.push({
        children: (
          <Segmented
            block
            options={[
              { label: t('extendParams.zhipuReasoningEffort.max'), value: 'max' },
              { label: t('extendParams.zhipuReasoningEffort.high'), value: 'high' },
              { label: t('extendParams.zhipuReasoningEffort.skip'), value: 'skip' },
            ]}
            size={'small'}
          />
        ),
        desc: (
          <span style={isNarrow ? descNarrow : descWide}>
            {t('extendParams.zhipuReasoningEffort.desc')}
          </span>
        ),
        label: t('extendParams.zhipuReasoningEffort.title'),
        layout: 'vertical',
        minWidth: 0,
        name: 'zhipuReasoningEffort',
      });
    }

    // Preserved Thinking (clear_thinking=false) requires thinking to be on. For
    // models with an enableReasoning toggle, that means the toggle must be on. For
    // forced-thinking models like glm-4.7 (no enableReasoning toggle), thinking is
    // always on, so the switch is always available.
    const showPreservedThinking =
      extendParams.includes('zhipuPreservedThinking') &&
      (extendParams.includes('enableReasoning') ? config.enableReasoning : true);
    if (showPreservedThinking) {
      result.push({
        children: <Switch />,
        desc: (
          <span style={isNarrow ? descNarrow : descWide}>
            {t('extendParams.zhipuPreservedThinking.desc')}
          </span>
        ),
        label: t('extendParams.zhipuPreservedThinking.title'),
        layout: isNarrow ? 'vertical' : 'horizontal',
        minWidth: undefined,
        name: 'zhipuPreservedThinking',
        valuePropName: 'checked',
      });
    }

    return result;
  }, [extendParams, config.enableReasoning, isNarrow, t]);

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

ZhipuOptions.displayName = 'ZhipuOptions';

export default ZhipuOptions;
