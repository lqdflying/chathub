import { Slider } from 'antd';
import { memo, useCallback, useMemo } from 'react';
import { Flexbox } from 'react-layout-kit';

import { useAgentStore } from '@/store/agent';
import { agentChatConfigSelectors, agentSelectors } from '@/store/agent/selectors';

type Gpt5LegacyEffort = 'minimal' | 'low' | 'medium' | 'high';
type Gpt55Effort = 'none' | 'low' | 'medium' | 'high' | 'xhigh';

const GPT5ReasoningEffortSlider = memo(() => {
  const [model, config, updateAgentChatConfig] = useAgentStore((s) => [
    agentSelectors.currentAgentModel(s),
    agentChatConfigSelectors.currentChatConfig(s),
    s.updateAgentChatConfig,
  ]);

  const isGpt55Family = model.startsWith('gpt-5.5');

  const { effortValues, marks, max } = useMemo(() => {
    if (isGpt55Family) {
      const values: Gpt55Effort[] = ['none', 'low', 'medium', 'high', 'xhigh'];
      return {
        effortValues: values,
        marks: Object.fromEntries(values.map((v, i) => [i, v])) as Record<number, string>,
        max: 4,
      };
    }
    const values: Gpt5LegacyEffort[] = ['minimal', 'low', 'medium', 'high'];
    return {
      effortValues: values,
      marks: Object.fromEntries(values.map((v, i) => [i, v])) as Record<number, string>,
      max: 3,
    };
  }, [isGpt55Family]);

  const gpt5ReasoningEffort = config.gpt5ReasoningEffort || 'medium';
  const indexValue = effortValues.indexOf(gpt5ReasoningEffort as any);
  const currentValue = indexValue === -1 ? effortValues.indexOf('medium') : indexValue;

  const updateGPT5ReasoningEffort = useCallback(
    (value: number) => {
      const effort = effortValues[value];
      if (effort) updateAgentChatConfig({ gpt5ReasoningEffort: effort as any });
    },
    [effortValues, updateAgentChatConfig],
  );

  return (
    <Flexbox style={{ paddingInlineEnd: 8, width: '100%' }}>
      <Slider
        marks={marks}
        max={max}
        min={0}
        onChange={updateGPT5ReasoningEffort}
        step={1}
        tooltip={{ open: false }}
        value={currentValue}
      />
    </Flexbox>
  );
});

export default GPT5ReasoningEffortSlider;
