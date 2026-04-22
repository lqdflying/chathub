import {
  REASONING_BUDGET_TOKEN_ADAPTIVE,
  supportsAnthropicAdaptiveThinking,
} from '@lobechat/model-runtime';
import { InputNumber } from '@lobehub/ui';
import { Slider, Switch, Typography } from 'antd';
import { useTheme } from 'antd-style';
import { memo, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Flexbox } from 'react-layout-kit';
import useMergeState from 'use-merge-value';

const Kibi = 1024;

const exponent = (num: number) => Math.log2(num);
const powerKibi = (num: number) => Math.round(Math.pow(2, num) * Kibi);

const tokenToPow = (t: number) => exponent(Math.max(t, Kibi) / Kibi);

interface MaxTokenSliderProps {
  adaptiveOnly?: boolean;
  defaultValue?: number;
  model?: string;
  onChange?: (value: number) => void;
  provider?: string;
  value?: number;
}

const AdaptiveBudgetBar = memo(() => {
  const theme = useTheme();
  return (
    <div
      aria-hidden
      style={{
        background: `linear-gradient(90deg, ${theme.colorInfo} 0%, ${theme.colorPrimary} 100%)`,
        borderRadius: 4,
        height: 6,
        opacity: 0.92,
        width: '100%',
      }}
    />
  );
});

const ReasoningTokenSlider = memo<MaxTokenSliderProps>(
  ({ value, onChange, defaultValue, provider, model, adaptiveOnly }) => {
    const { t } = useTranslation('chat');
    const supportsAdaptiveOption =
      adaptiveOnly || (provider === 'anthropic' && !!model && supportsAnthropicAdaptiveThinking(model));

    const resolvedDefault = defaultValue ?? 1024;
    const initialToken = adaptiveOnly ? REASONING_BUDGET_TOKEN_ADAPTIVE : (value ?? resolvedDefault);

    const [token, setTokens] = useMergeState(initialToken, {
      defaultValue: adaptiveOnly ? REASONING_BUDGET_TOKEN_ADAPTIVE : resolvedDefault,
      onChange,
      value,
    });

    const isAdaptive =
      supportsAdaptiveOption && !adaptiveOnly && token === REASONING_BUDGET_TOKEN_ADAPTIVE;
    const displayToken =
      !supportsAdaptiveOption && token === REASONING_BUDGET_TOKEN_ADAPTIVE
        ? resolvedDefault
        : token;

    useEffect(() => {
      if (!adaptiveOnly) return;
      if (token !== REASONING_BUDGET_TOKEN_ADAPTIVE) {
        setTokens(REASONING_BUDGET_TOKEN_ADAPTIVE);
      }
    }, [adaptiveOnly, setTokens, token]);

    /** Saved config may be adaptive (-1) after switching to a model without adaptive thinking. */
    useEffect(() => {
      if (supportsAdaptiveOption || adaptiveOnly) return;
      if (token === REASONING_BUDGET_TOKEN_ADAPTIVE) {
        setTokens(resolvedDefault);
      }
    }, [adaptiveOnly, resolvedDefault, setTokens, supportsAdaptiveOption, token]);

    const powValue = useMemo(
      () => tokenToPow(isAdaptive ? Kibi : displayToken),
      [displayToken, isAdaptive],
    );

    const marks = useMemo(() => {
      const base: Record<number, string> = {
        [exponent(1)]: '1k',
        [exponent(2)]: '2k',
        [exponent(4)]: '4k',
        [exponent(8)]: '8k',
        [exponent(16)]: '16k',
        [exponent(32)]: '32k',
        [exponent(64)]: '64k',
      };
      return base;
    }, []);

    const step = useMemo(() => {
      const current = displayToken ?? 0;
      if (current <= Kibi) return 128;
      if (current < 8 * Kibi) return Kibi;
      return 4 * Kibi;
    }, [displayToken]);

    const updateWithPowValue = (p: number) => {
      setTokens(Math.min(powerKibi(p), 64_000));
    };

    /** Fixed-budget input for hybrid mode (never writes adaptive sentinel). */
    const updateFixedFromInput = (v: number) => {
      const next = Math.min(Math.max(Kibi, Math.round(v)), 64_000);
      setTokens(next);
    };

    /** Legacy models without adaptive option may use 0…64k. */
    const updateAnyFromInput = (v: number) => {
      const next = Math.min(Math.max(0, Math.round(v)), 64_000);
      setTokens(next);
    };

    const setAdaptiveEnabled = (enabled: boolean) => {
      if (enabled) setTokens(REASONING_BUDGET_TOKEN_ADAPTIVE);
      else setTokens(Math.max(Kibi, token === REASONING_BUDGET_TOKEN_ADAPTIVE ? resolvedDefault : token));
    };

    /** Adaptive-only models: toggle is always on (read-only); bar + hint below */
    if (adaptiveOnly) {
      return (
        <Flexbox gap={6} width={'100%'}>
          <Flexbox align={'center'} horizontal justify={'space-between'}>
            <Typography.Text style={{ fontSize: 12 }}>
              {t('extendParams.reasoningBudgetToken.adaptive')}
            </Typography.Text>
            <Switch checked disabled size="small" />
          </Flexbox>
          <AdaptiveBudgetBar />
          <Typography.Text style={{ fontSize: 11 }} type={'secondary'}>
            {t('extendParams.reasoningBudgetToken.adaptiveOnlyHint')}
          </Typography.Text>
        </Flexbox>
      );
    }

    /** No adaptive API: classic slider + number */
    if (!supportsAdaptiveOption) {
      return (
        <Flexbox align={'center'} gap={12} horizontal paddingInline={'4px 0'}>
          <Flexbox flex={1}>
            <Slider
              marks={marks}
              max={exponent(64)}
              min={exponent(1)}
              onChange={updateWithPowValue}
              step={null}
              tooltip={{ open: false }}
              value={powValue}
            />
          </Flexbox>
          <div>
            <InputNumber
              changeOnWheel
              max={64_000}
              min={0}
              onChange={(e) => {
                if (e === null || e === undefined) return;
                updateAnyFromInput(e as number);
              }}
              step={step}
              style={{ width: 88 }}
              value={displayToken}
            />
          </div>
        </Flexbox>
      );
    }

    /** Hybrid: switch + optional bar, or fixed slider + number */
    return (
      <Flexbox gap={8} width={'100%'}>
        <Flexbox align={'center'} horizontal justify={'space-between'}>
          <Typography.Text style={{ fontSize: 12 }}>
            {t('extendParams.reasoningBudgetToken.adaptive')}
          </Typography.Text>
          <Switch checked={isAdaptive} onChange={setAdaptiveEnabled} size="small" />
        </Flexbox>

        {isAdaptive ? (
          <Flexbox gap={4}>
            <AdaptiveBudgetBar />
            <Typography.Text style={{ fontSize: 11 }} type={'secondary'}>
              {t('extendParams.reasoningBudgetToken.adaptiveHint')}
            </Typography.Text>
          </Flexbox>
        ) : (
          <Flexbox align={'center'} gap={10} horizontal width={'100%'}>
            <Flexbox flex={1}>
              <Slider
                marks={marks}
                max={exponent(64)}
                min={exponent(1)}
                onChange={updateWithPowValue}
                step={null}
                tooltip={{ open: false }}
                value={powValue}
              />
            </Flexbox>
            <div>
              <InputNumber
                changeOnWheel
                max={64_000}
                min={Kibi}
                onChange={(e) => {
                  if (e === null || e === undefined) return;
                  updateFixedFromInput(e as number);
                }}
                size="small"
                step={step}
                style={{ width: 72 }}
                value={displayToken}
              />
            </div>
          </Flexbox>
        )}
      </Flexbox>
    );
  },
);

export default ReasoningTokenSlider;
