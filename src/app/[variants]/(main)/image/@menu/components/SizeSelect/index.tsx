'use client';

import { ActionIcon, Alert, Block, Grid, GridProps, InputNumber, Select, Text } from '@lobehub/ui';
import { createStyles, useTheme } from 'antd-style';
import { Check, SlidersHorizontal, X } from 'lucide-react';
import type { ImageSizeValidationError, ModelParamsSchema } from 'model-bank';
import { isExperimentalImageSize, validateImageSize } from 'model-bank';
import React, { ReactNode, memo, useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Center, Flexbox } from 'react-layout-kit';
import useMergeState from 'use-merge-value';

const useStyles = createStyles(({ css, token }) => ({
  actionButton: css`
    flex-shrink: 0;
  `,
  customActions: css`
    align-self: end;
    padding-block-end: 1px;
  `,
  customEditor: css`
    padding: 12px;
    border: 1px solid ${token.colorBorderSecondary};
    border-radius: ${token.borderRadius}px;
    background: ${token.colorBgContainer};
  `,
  customInput: css`
    width: 100%;
  `,
  customInputs: css`
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) auto;
    gap: 8px;
    align-items: end;

    @media (max-width: 360px) {
      grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);

      .custom-actions {
        grid-column: 1 / -1;
        justify-self: end;
      }
    }
  `,
  error: css`
    min-height: 18px;
    margin-block-start: 6px;
    font-size: 12px;
    color: ${token.colorError};
  `,
  group: css`
    width: 100%;
  `,
  groupGrid: css`
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(92px, 1fr));
    gap: 4px;
    width: 100%;
  `,
  groupLabel: css`
    font-size: 12px;
    font-weight: 500;
    color: ${token.colorTextSecondary};
  `,
  inputLabel: css`
    font-size: 12px;
    color: ${token.colorTextSecondary};
  `,
  option: css`
    cursor: pointer;

    min-width: 0;
    min-height: 66px;
    padding: 8px;
    border: 0;
    border-radius: ${token.borderRadius}px;

    color: ${token.colorText};

    background: transparent;

    &:hover {
      background: ${token.colorBgTextHover};
    }

    &:focus-visible {
      outline: 2px solid ${token.colorPrimary};
      outline-offset: -2px;
    }
  `,
  optionActive: css`
    background: ${token.colorBgElevated};
    box-shadow: ${token.boxShadowTertiary};
  `,
  optionLabel: css`
    overflow: hidden;
    max-width: 100%;
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  optionValue: css`
    overflow: hidden;
    max-width: 100%;
    font-size: 11px;
    color: ${token.colorTextSecondary};
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  tieredContainer: css`
    width: 100%;
  `,
  warning: css`
    font-size: 12px;
  `,
}));

export interface SizeSelectProps extends Omit<GridProps, 'children' | 'onChange'> {
  defaultValue?: 'auto' | string;
  onChange?: (value: string) => void;
  options?: { label?: string; value: 'auto' | string }[];
  sizeSchema?: ModelParamsSchema['size'];
  value?: 'auto' | string;
}

/**
 * Check if a size value can be parsed as valid aspect ratio
 */
const canParseAsRatio = (value: string): boolean => {
  if (value === 'auto') return true;

  const parts = value.split('x');
  if (parts.length !== 2) return false;

  const [width, height] = parts.map(Number);
  return !isNaN(width) && !isNaN(height) && width > 0 && height > 0;
};

const parseDimensions = (size: string | undefined): { height: number; width: number } | undefined => {
  if (!size) return;

  const sizeMatch = /^(\d+)x(\d+)$/.exec(size);
  if (!sizeMatch) return;

  return { height: Number(sizeMatch[2]), width: Number(sizeMatch[1]) };
};

const SizeSelect = memo<SizeSelectProps>(
  ({ options, onChange, sizeSchema, value, defaultValue, ...rest }) => {
    const { t } = useTranslation('image');
    const theme = useTheme();
    const { styles, cx } = useStyles();
    const [active, setActive] = useMergeState('auto', {
      defaultValue,
      value,
    });
    const [isEditingCustom, setIsEditingCustom] = useState(false);
    const [customWidth, setCustomWidth] = useState<number | null>(null);
    const [customHeight, setCustomHeight] = useState<number | null>(null);

    const customConstraints = sizeSchema?.custom;
    const supportsCustomSizes = !!customConstraints;
    const presetValues = useMemo(
      () => new Set(options?.map((option) => option.value)),
      [options],
    );
    const isCustomActive = !!active && active !== 'auto' && !presetValues.has(active);
    const customValue =
      customWidth === null || customHeight === null ? undefined : `${customWidth}x${customHeight}`;
    const customValidation = supportsCustomSizes
      ? validateImageSize(sizeSchema, customValue)
      : undefined;

    const selectValue = useCallback(
      (nextValue: string) => {
        setActive(nextValue);
        onChange?.(nextValue);
        setIsEditingCustom(false);
      },
      [onChange, setActive],
    );

    const openCustomEditor = useCallback(() => {
      const currentDimensions = parseDimensions(active);
      setCustomWidth(currentDimensions?.width ?? 1024);
      setCustomHeight(currentDimensions?.height ?? 1024);
      setIsEditingCustom(true);
    }, [active]);

    const confirmCustomSize = useCallback(() => {
      if (!customValue) return;

      const validationResult = validateImageSize(sizeSchema, customValue);
      if (!validationResult.valid) return;

      selectValue(customValue);
    }, [customValue, selectValue, sizeSchema]);

    const cancelCustomSize = useCallback(() => {
      setIsEditingCustom(false);
      setCustomWidth(null);
      setCustomHeight(null);
    }, []);

    const handleCustomKeyDown = useCallback(
      (event: React.KeyboardEvent) => {
        if (event.key !== 'Escape') return;

        event.preventDefault();
        cancelCustomSize();
      },
      [cancelCustomSize],
    );

    const renderRatioIcon = useCallback(
      (size: string, isActive: boolean): ReactNode => {
        if (size === 'auto') {
          return (
            <div
              style={{
                border: `2px dashed ${isActive ? theme.colorText : theme.colorTextDescription}`,
                borderRadius: 3,
                height: 16,
                width: 16,
              }}
            />
          );
        }

        const dimensions = parseDimensions(size);
        if (!dimensions) return null;

        const isLandscape = dimensions.width > dimensions.height;
        return (
          <div
            style={{
              aspectRatio: `${dimensions.width} / ${dimensions.height}`,
              border: `2px solid ${isActive ? theme.colorText : theme.colorTextDescription}`,
              borderRadius: 3,
              height: isLandscape ? undefined : 16,
              width: isLandscape ? 16 : undefined,
            }}
          />
        );
      },
      [theme.colorText, theme.colorTextDescription],
    );

    const renderTierOption = useCallback(
      (optionValue: string, optionLabel?: string) => {
        const isActive = active === optionValue;
        const dimensions = parseDimensions(optionValue);
        const orientation = dimensions
          ? dimensions.width === dimensions.height
            ? t('config.size.orientation.square')
            : dimensions.width > dimensions.height
              ? t('config.size.orientation.landscape')
              : t('config.size.orientation.portrait')
          : optionLabel || optionValue;

        return (
          <button
            aria-pressed={isActive}
            className={cx(styles.option, isActive && styles.optionActive)}
            key={optionValue}
            onClick={() => selectValue(optionValue)}
            type="button"
          >
            <Flexbox align={'center'} gap={4} justify={'center'}>
              <Center height={16} width={16}>
                {renderRatioIcon(optionValue, isActive)}
              </Center>
              <Text className={styles.optionLabel} fontSize={12}>
                {orientation}
              </Text>
              {dimensions && <span className={styles.optionValue}>{optionValue}</span>}
            </Flexbox>
          </button>
        );
      },
      [
        active,
        cx,
        renderRatioIcon,
        selectValue,
        styles.option,
        styles.optionActive,
        styles.optionLabel,
        styles.optionValue,
        t,
      ],
    );

    if (supportsCustomSizes) {
      const autoOption = options?.find((option) => option.value === 'auto');
      const groupedValues = new Set(sizeSchema?.groups?.flatMap((group) => group.values));
      const ungroupedOptions = options?.filter(
        (option) => option.value !== 'auto' && !groupedValues.has(option.value),
      );
      const validationError =
        customValidation && !customValidation.valid
          ? t(`config.size.errors.${customValidation.error as ImageSizeValidationError}`, {
              maxAspectRatio: customConstraints.maxAspectRatio,
              maxEdge: customConstraints.maxEdge,
              maxPixels: customConstraints.maxPixels.toLocaleString(),
              minPixels: customConstraints.minPixels.toLocaleString(),
              step: customConstraints.step,
            })
          : undefined;

      return (
        <Flexbox className={styles.tieredContainer} gap={8}>
          {autoOption && (
            <Flexbox className={styles.group} gap={4}>
              <span className={styles.groupLabel}>{t('config.size.tiers.auto')}</span>
              <div className={styles.groupGrid}>
                {renderTierOption(autoOption.value, t('config.size.auto'))}
              </div>
            </Flexbox>
          )}

          {sizeSchema?.groups?.map((group) => (
            <Flexbox className={styles.group} gap={4} key={group.key}>
              <span className={styles.groupLabel}>{t(`config.size.tiers.${group.key}`)}</span>
              <div className={styles.groupGrid}>
                {group.values.map((optionValue) =>
                  renderTierOption(
                    optionValue,
                    options?.find((option) => option.value === optionValue)?.label,
                  ),
                )}
              </div>
            </Flexbox>
          ))}

          {!!ungroupedOptions?.length && (
            <div className={styles.groupGrid}>
              {ungroupedOptions.map((option) => renderTierOption(option.value, option.label))}
            </div>
          )}

          <Flexbox className={styles.group} gap={4}>
            <span className={styles.groupLabel}>{t('config.size.tiers.custom')}</span>
            <div className={styles.groupGrid}>
              <button
                aria-expanded={isEditingCustom}
                aria-pressed={isCustomActive}
                className={cx(styles.option, isCustomActive && styles.optionActive)}
                onClick={openCustomEditor}
                type="button"
              >
                <Flexbox align={'center'} gap={4} justify={'center'}>
                  <Center height={16} width={16}>
                    <SlidersHorizontal size={16} />
                  </Center>
                  <Text className={styles.optionLabel} fontSize={12}>
                    {t('config.size.custom')}
                  </Text>
                  <span className={styles.optionValue}>
                    {isCustomActive ? active : t('config.size.customDescription')}
                  </span>
                </Flexbox>
              </button>
            </div>
          </Flexbox>

          {isEditingCustom && (
            <div className={styles.customEditor} onKeyDown={handleCustomKeyDown}>
              <div className={styles.customInputs}>
                <Flexbox gap={4}>
                  <label className={styles.inputLabel}>{t('config.width.label')}</label>
                  <InputNumber
                    aria-label={t('config.width.label')}
                    className={styles.customInput}
                    max={customConstraints.maxEdge}
                    min={customConstraints.step}
                    onChange={(inputValue) =>
                      setCustomWidth(inputValue === null ? null : Number(inputValue))
                    }
                    onPressEnter={confirmCustomSize}
                    step={customConstraints.step}
                    value={customWidth}
                  />
                </Flexbox>
                <Flexbox gap={4}>
                  <label className={styles.inputLabel}>{t('config.height.label')}</label>
                  <InputNumber
                    aria-label={t('config.height.label')}
                    className={styles.customInput}
                    max={customConstraints.maxEdge}
                    min={customConstraints.step}
                    onChange={(inputValue) =>
                      setCustomHeight(inputValue === null ? null : Number(inputValue))
                    }
                    onPressEnter={confirmCustomSize}
                    step={customConstraints.step}
                    value={customHeight}
                  />
                </Flexbox>
                <Flexbox className={`${styles.customActions} custom-actions`} gap={4} horizontal>
                  <ActionIcon
                    aria-label={t('config.size.confirm')}
                    className={styles.actionButton}
                    disabled={!customValidation?.valid}
                    icon={Check}
                    onClick={confirmCustomSize}
                    size={'small'}
                  />
                  <ActionIcon
                    aria-label={t('config.size.cancel')}
                    className={styles.actionButton}
                    icon={X}
                    onClick={cancelCustomSize}
                    size={'small'}
                  />
                </Flexbox>
              </div>
              <div aria-live="polite" className={styles.error}>
                {validationError}
              </div>
            </div>
          )}

          {isExperimentalImageSize(sizeSchema, active) && (
            <Alert
              className={styles.warning}
              message={t('config.size.experimentalWarning')}
              showIcon
              type={'warning'}
              variant={'borderless'}
            />
          )}
        </Flexbox>
      );
    }

    const hasInvalidRatio = options?.some((item) => !canParseAsRatio(item.value));
    if (hasInvalidRatio) {
      return (
        <Select onChange={onChange} options={options} style={{ width: '100%' }} value={active} />
      );
    }

    return (
      <Block padding={4} variant={'filled'} {...rest}>
        <Grid gap={4} maxItemWidth={72} rows={16}>
          {options?.map((item) => {
            const isActive = active === item.value;

            return (
              <Block
                align={'center'}
                clickable
                gap={4}
                justify={'center'}
                key={item.value}
                onClick={() => selectValue(item.value)}
                padding={8}
                shadow={isActive && !theme.isDarkMode}
                style={{
                  backgroundColor: isActive ? theme.colorBgElevated : 'transparent',
                }}
                variant={'filled'}
              >
                <Center height={16} style={{ marginTop: 4 }} width={16}>
                  {renderRatioIcon(item.value, isActive)}
                </Center>
                <Text fontSize={12} type={isActive ? undefined : 'secondary'}>
                  {item.label || item.value}
                </Text>
              </Block>
            );
          })}
        </Grid>
      </Block>
    );
  },
);

export default SizeSelect;
