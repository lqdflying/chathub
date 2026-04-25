import { Slider } from 'antd';
import { memo, useCallback, useMemo } from 'react';
import { Flexbox } from 'react-layout-kit';

import { useAgentStore } from '@/store/agent';
import { agentChatConfigSelectors, agentSelectors } from '@/store/agent/selectors';

import { mergeDiscreteSliderShell } from './discreteSliderShell';

type Gpt5LegacyEffort = 'minimal' | 'low' | 'medium' | 'high';
type Gpt55Effort = 'low' | 'medium' | 'high' | 'xhigh';

const GPT5ReasoningEffortSlider = memo(() => {
  const [model, config, updateAgentChatConfig] = useAgentStore((s) => [
    agentSelectors.currentAgentModel(s),
    agentChatConfigSelectors.currentChatConfig(s),
    s.updateAgentChatConfig,
  ]);

  const isGpt55Family = model.startsWith('gpt-5.5');

  const { effortValues, marks, max } = useMemo(() => {
    if (isGpt55Family) {
      const values: Gpt55Effort[] = ['low', 'medium', 'high', 'xhigh'];
      return {
        effortValues: values,
        marks: Object.fromEntries(values.map((v, i) => [i, v])) as Record<number, string>,
        max: 3,
      };
    }
    const values: Gpt5LegacyEffort[] = ['minimal', 'low', 'medium', 'high'];
    return {
      effortValues: values,
      marks: Object.fromEntries(values.map((v, i) => [i, v])) as Record<number, string>,
      max: 3,
    };
  }, [isGpt55Family]);

  const rawEffort = config.gpt5ReasoningEffort || 'medium';
  const gpt5ReasoningEffort = (() => {
    if (!isGpt55Family) return rawEffort;
    if (rawEffort === 'none' || rawEffort === 'minimal') return 'low';
    if (effortValues.includes(rawEffort as Gpt55Effort)) return rawEffort as Gpt55Effort;
    return 'medium';
  })();
  const indexValue = effortValues.indexOf(gpt5ReasoningEffort as any);
  const currentValue = indexValue === -1 ? effortValues.indexOf('medium') : indexValue;

  const updateGPT5ReasoningEffort = useCallback(
    (value: number) => {
      const effort = effortValues[value];
      if (effort) updateAgentChatConfig({ gpt5ReasoningEffort: effort as any });
    },
    [effortValues, updateAgentChatConfig],
  );

  // First mark is centered on the left rail end; labels extend ~50% leftward. Legacy
  // GPT-5.x uses "minimal" (wider than "low" on gpt-5.5) — extra start inset on non-5.5.
  const sliderGutter = isGpt55Family
    ? { paddingInline: 12 as const }
    : { paddingInlineEnd: 10 as const, paddingInlineStart: 26 as const };

  return (
    <Flexbox style={mergeDiscreteSliderShell(sliderGutter)}>
      <Slider
        marks={marks}
        max={max}
        min={0}
        onChange={updateGPT5ReasoningEffort}
        step={1}
        styles={{ mark: { fontSize: isGpt55Family ? 11 : 10 } }}
        tooltip={{ open: false }}
        value={currentValue}
      />
    </Flexbox>
  );
});

export default GPT5ReasoningEffortSlider;
