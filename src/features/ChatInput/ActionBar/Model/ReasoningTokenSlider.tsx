import {
  REASONING_BUDGET_TOKEN_ADAPTIVE,
  supportsAnthropicAdaptiveThinking,
} from '@lobechat/model-runtime';
import { InputNumber } from '@lobehub/ui';
import { Slider } from 'antd';
import { memo, useEffect, useMemo } from 'react';
import { Flexbox } from 'react-layout-kit';
import useMergeState from 'use-merge-value';

const Kibi = 1024;

const exponent = (num: number) => Math.log2(num);
const powerKibi = (num: number) => Math.round(Math.pow(2, num) * Kibi);

/** Slider index for Anthropic adaptive thinking (before 1k). */
const SLIDER_POS_ADAPTIVE = -1;

const tokenToPow = (t: number, supportsAdaptive: boolean) => {
  if (supportsAdaptive && t === REASONING_BUDGET_TOKEN_ADAPTIVE) return SLIDER_POS_ADAPTIVE;
  return exponent(Math.max(t, Kibi) / Kibi);
};

interface MaxTokenSliderProps {
  adaptiveOnly?: boolean;
  defaultValue?: number;
  model?: string;
  onChange?: (value: number) => void;
  provider?: string;
  value?: number;
}

const ReasoningTokenSlider = memo<MaxTokenSliderProps>(
  ({ value, onChange, defaultValue, provider, model, adaptiveOnly }) => {
    const supportsAdaptiveOption =
      adaptiveOnly || (provider === 'anthropic' && !!model && supportsAnthropicAdaptiveThinking(model));

    const resolvedDefault = defaultValue ?? 1024;
    const initialToken = adaptiveOnly ? REASONING_BUDGET_TOKEN_ADAPTIVE : (value ?? resolvedDefault);

    const [token, setTokens] = useMergeState(initialToken, {
      defaultValue: adaptiveOnly ? REASONING_BUDGET_TOKEN_ADAPTIVE : resolvedDefault,
      onChange,
      value,
    });

    useEffect(() => {
      if (!adaptiveOnly) return;
      if (token !== REASONING_BUDGET_TOKEN_ADAPTIVE) {
        setTokens(REASONING_BUDGET_TOKEN_ADAPTIVE);
      }
    }, [adaptiveOnly, setTokens, token]);

    const powValue = useMemo(
      () => tokenToPow(token, supportsAdaptiveOption),
      [supportsAdaptiveOption, token],
    );

    const minPow = adaptiveOnly
      ? SLIDER_POS_ADAPTIVE
      : supportsAdaptiveOption
        ? SLIDER_POS_ADAPTIVE
        : exponent(1);
    const maxPow = adaptiveOnly ? SLIDER_POS_ADAPTIVE : exponent(64);

    const updateWithPowValue = (p: number) => {
      if (supportsAdaptiveOption && p === SLIDER_POS_ADAPTIVE) {
        setTokens(REASONING_BUDGET_TOKEN_ADAPTIVE);
        return;
      }
      setTokens(Math.min(powerKibi(p), 64_000));
    };

    const updateWithRealValue = (v: number) => {
      if (supportsAdaptiveOption && v === REASONING_BUDGET_TOKEN_ADAPTIVE) {
        setTokens(REASONING_BUDGET_TOKEN_ADAPTIVE);
        return;
      }
      const next = Math.min(Math.max(0, Math.round(v)), 64_000);
      setTokens(next);
    };

    const marks = useMemo(() => {
      if (adaptiveOnly) {
        return { [SLIDER_POS_ADAPTIVE]: 'Adaptive' };
      }
      const base: Record<number, string> = {
        [exponent(1)]: '1k',
        [exponent(2)]: '2k',
        [exponent(4)]: '4k',
        [exponent(8)]: '8k',
        [exponent(16)]: '16k',
        [exponent(32)]: '32k',
        [exponent(64)]: '64k',
      };
      if (supportsAdaptiveOption) {
        return { [SLIDER_POS_ADAPTIVE]: 'Adaptive', ...base };
      }
      return base;
    }, [adaptiveOnly, supportsAdaptiveOption]);

    const step = useMemo(() => {
      const current =
        token === REASONING_BUDGET_TOKEN_ADAPTIVE ? Kibi : (token ?? 0);

      if (current <= Kibi) return 128;

      if (current < 8 * Kibi) return Kibi;

      return 4 * Kibi;
    }, [token]);

    return (
      <Flexbox align={'center'} gap={12} horizontal paddingInline={'4px 0'}>
        <Flexbox flex={1}>
          <Slider
            marks={marks}
            max={maxPow}
            min={minPow}
            onChange={updateWithPowValue}
            step={null}
            tooltip={{ open: false }}
            value={powValue}
          />
        </Flexbox>
        <div>
          <InputNumber
            changeOnWheel
            formatter={(v) => {
              if (v === REASONING_BUDGET_TOKEN_ADAPTIVE) return 'Adaptive';
              return `${v ?? ''}`;
            }}
            max={64_000}
            min={supportsAdaptiveOption ? REASONING_BUDGET_TOKEN_ADAPTIVE : 0}
            onChange={(e) => {
              if (e === null || e === undefined) return;
              updateWithRealValue(e as number);
            }}
            parser={(str) => {
              if (typeof str === 'string' && str.trim().toLowerCase() === 'adaptive') {
                return REASONING_BUDGET_TOKEN_ADAPTIVE;
              }
              const n = parseInt(String(str).replaceAll(/[^\d-]/g, ''), 10);
              return Number.isNaN(n) ? 0 : n;
            }}
            step={adaptiveOnly ? 1 : step}
            style={{ width: 88 }}
            value={token}
          />
        </div>
      </Flexbox>
    );
  },
);
export default ReasoningTokenSlider;
