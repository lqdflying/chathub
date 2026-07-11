import { Slider } from 'antd';
import { resolveGPT5ReasoningEffort } from '@lobechat/types';
import { memo, useCallback, useMemo } from 'react';
import { Flexbox } from 'react-layout-kit';

import { useAgentStore } from '@/store/agent';
import { agentChatConfigSelectors, agentSelectors } from '@/store/agent/selectors';

import { mergeDiscreteSliderShell } from './discreteSliderShell';

const GPT5ReasoningEffortSlider = memo(() => {
  const [model, config, updateAgentChatConfig] = useAgentStore((s) => [
    agentSelectors.currentAgentModel(s),
    agentChatConfigSelectors.currentChatConfig(s),
    s.updateAgentChatConfig,
  ]);

  const { effort, effortValues } = resolveGPT5ReasoningEffort(
    model,
    config.gpt5ReasoningEffort,
  );
  const marks = useMemo(
    () =>
      Object.fromEntries(effortValues.map((effortValue, index) => [index, effortValue])) as Record<
        number,
        string
      >,
    [effortValues],
  );
  const currentValue = effortValues.indexOf(effort);

  const updateGPT5ReasoningEffort = useCallback(
    (value: number) => {
      const effort = effortValues[value];
      if (effort) updateAgentChatConfig({ gpt5ReasoningEffort: effort });
    },
    [effortValues, updateAgentChatConfig],
  );

  const isLegacyGpt5Family = effortValues[0] === 'minimal';
  const sliderGutter = isLegacyGpt5Family
    ? { paddingInlineEnd: 10 as const, paddingInlineStart: 26 as const }
    : { paddingInline: 12 as const };

  return (
    <Flexbox style={mergeDiscreteSliderShell(sliderGutter)}>
      <Slider
        marks={marks}
        max={effortValues.length - 1}
        min={0}
        onChange={updateGPT5ReasoningEffort}
        step={1}
        styles={{ mark: { fontSize: effortValues.length > 4 ? 10 : 11 } }}
        tooltip={{ open: false }}
        value={currentValue}
      />
    </Flexbox>
  );
});

export default GPT5ReasoningEffortSlider;
