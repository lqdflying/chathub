import { Slider } from 'antd';
import { memo, useCallback } from 'react';
import { Flexbox } from 'react-layout-kit';

import { useAgentStore } from '@/store/agent';
import { agentChatConfigSelectors } from '@/store/agent/selectors';

import { mergeDiscreteSliderShell } from './discreteSliderShell';

const ReasoningEffortSlider = memo(() => {
  const [config, updateAgentChatConfig] = useAgentStore((s) => [
    agentChatConfigSelectors.currentChatConfig(s),
    s.updateAgentChatConfig,
  ]);

  const reasoningEffort = config.reasoningEffort || 'medium'; // Default to 'medium' if not set

  const marks = {
    0: 'low',
    1: 'medium',
    2: 'high',
  };

  const effortValues = ['low', 'medium', 'high'];
  const indexValue = effortValues.indexOf(reasoningEffort);
  const currentValue = indexValue === -1 ? 1 : indexValue;

  const updateReasoningEffort = useCallback(
    (value: number) => {
      const effort = effortValues[value] as 'low' | 'medium' | 'high';
      updateAgentChatConfig({ reasoningEffort: effort });
    },
    [updateAgentChatConfig],
  );

  return (
    <Flexbox style={mergeDiscreteSliderShell({ paddingInline: 12 })}>
      <Slider
        marks={marks}
        max={2}
        min={0}
        onChange={updateReasoningEffort}
        step={1}
        styles={{ mark: { fontSize: 11 } }}
        tooltip={{ open: false }}
        value={currentValue}
      />
    </Flexbox>
  );
});

export default ReasoningEffortSlider;
