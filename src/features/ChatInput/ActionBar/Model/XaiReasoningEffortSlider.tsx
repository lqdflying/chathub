import { Slider } from 'antd';
import { resolveXaiReasoningEffort } from '@lobechat/types';
import { memo, useCallback, useMemo } from 'react';
import { Flexbox } from 'react-layout-kit';

import { useAgentStore } from '@/store/agent';
import { agentChatConfigSelectors, agentSelectors } from '@/store/agent/selectors';

import { mergeDiscreteSliderShell } from './discreteSliderShell';

const XaiReasoningEffortSlider = memo(() => {
  const [model, config, updateAgentChatConfig] = useAgentStore((s) => [
    agentSelectors.currentAgentModel(s),
    agentChatConfigSelectors.currentChatConfig(s),
    s.updateAgentChatConfig,
  ]);

  const { effort, effortValues } = resolveXaiReasoningEffort(model, config.xaiReasoningEffort);
  const marks = useMemo(
    () =>
      Object.fromEntries(effortValues.map((effortValue, index) => [index, effortValue])) as Record<
        number,
        string
      >,
    [effortValues],
  );
  const currentValue = effort ? effortValues.indexOf(effort) : 0;

  const updateXaiReasoningEffort = useCallback(
    (value: number) => {
      const nextEffort = effortValues[value];
      if (nextEffort) updateAgentChatConfig({ xaiReasoningEffort: nextEffort });
    },
    [effortValues, updateAgentChatConfig],
  );

  if (effortValues.length === 0) return null;

  return (
    <Flexbox style={mergeDiscreteSliderShell({ paddingInline: 12 })}>
      <Slider
        marks={marks}
        max={effortValues.length - 1}
        min={0}
        onChange={updateXaiReasoningEffort}
        step={1}
        tooltip={{ open: false }}
        value={Math.max(0, currentValue)}
      />
    </Flexbox>
  );
});

export default XaiReasoningEffortSlider;
