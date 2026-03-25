'use client';

import { ActionIcon } from '@lobehub/ui';
import {
  App,
  Button,
  Checkbox,
  Divider,
  Input,
  InputNumber,
  Slider,
  Tag,
  Tooltip,
  Typography,
} from 'antd';
import { createStyles } from 'antd-style';
import { Check, Copy, RefreshCw } from 'lucide-react';
import { memo, useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Flexbox } from 'react-layout-kit';

const UPPERCASE = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const LOWERCASE = 'abcdefghijklmnopqrstuvwxyz';
const NUMBERS = '0123456789';
const SYMBOLS = '!@#$%^&*()_+-=[]{}|;:,.<>?';
const AMBIGUOUS = /[01IOl]/g;

const useStyles = createStyles(({ css, token }) => ({
  card: css`
    padding: 24px;
    border: 1px solid ${token.colorBorderSecondary};
    border-radius: ${token.borderRadiusLG}px;
    background: ${token.colorBgContainer};
  `,
  label: css`
    min-width: 140px;
    font-size: 13px;
    color: ${token.colorTextSecondary};
  `,
  output: css`
    cursor: default;
    user-select: all;

    padding-block: 12px !important;
    padding-inline: 16px !important;
    border-radius: ${token.borderRadius}px;

    font-family: ${token.fontFamilyCode};
    font-size: 15px;
    letter-spacing: 0.04em;

    background: ${token.colorFillTertiary} !important;
  `,
  strength: css`
    font-size: 12px;
    font-weight: 500;
  `,
  title: css`
    margin-block-end: 0 !important;
  `,
}));

const getStrength = (password: string): { color: string; label: string } => {
  if (!password) return { color: 'default', label: '' };
  const len = password.length;
  const hasUpper = /[A-Z]/.test(password);
  const hasLower = /[a-z]/.test(password);
  const hasNum = /\d/.test(password);
  const hasSym = /[^\dA-Za-z]/.test(password);
  const variety = [hasUpper, hasLower, hasNum, hasSym].filter(Boolean).length;

  if (len >= 20 && variety >= 4) return { color: 'success', label: 'Very Strong' };
  if (len >= 16 && variety >= 3) return { color: 'processing', label: 'Strong' };
  if (len >= 12 && variety >= 2) return { color: 'warning', label: 'Fair' };
  return { color: 'error', label: 'Weak' };
};

const generatePassword = (opts: {
  count: number;
  customSymbols: string;
  excludeAmbiguous: boolean;
  length: number;
  useCustomSymbols: boolean;
  useLower: boolean;
  useNumbers: boolean;
  useSymbols: boolean;
  useUpper: boolean;
}): string[] => {
  let charset = '';
  if (opts.useUpper) charset += UPPERCASE;
  if (opts.useLower) charset += LOWERCASE;
  if (opts.useNumbers) charset += NUMBERS;
  if (opts.useSymbols)
    charset += opts.useCustomSymbols && opts.customSymbols ? opts.customSymbols : SYMBOLS;
  if (opts.excludeAmbiguous) charset = charset.replaceAll(AMBIGUOUS, '');
  if (!charset) return [''];

  return Array.from({ length: opts.count }, () =>
    Array.from(
      { length: opts.length },
      () => charset[Math.floor(Math.random() * charset.length)],
    ).join(''),
  );
};

const PasswordWorkspace = memo(() => {
  const { styles } = useStyles();
  const { t } = useTranslation('tools');
  const { message } = App.useApp();

  const [length, setLength] = useState(20);
  const [count, setCount] = useState(1);
  const [useUpper, setUseUpper] = useState(true);
  const [useLower, setUseLower] = useState(true);
  const [useNumbers, setUseNumbers] = useState(true);
  const [useSymbols, setUseSymbols] = useState(true);
  const [excludeAmbiguous, setExcludeAmbiguous] = useState(false);
  const [useCustomSymbols, setUseCustomSymbols] = useState(false);
  const [customSymbols, setCustomSymbols] = useState('!@#$%^&*');
  const [passwords, setPasswords] = useState<string[]>([]);
  const [copied, setCopied] = useState(false);

  const generate = useCallback(() => {
    const result = generatePassword({
      count,
      customSymbols,
      excludeAmbiguous,
      length,
      useCustomSymbols,
      useLower,
      useNumbers,
      useSymbols,
      useUpper,
    });
    setPasswords(result);
    setCopied(false);
  }, [
    count,
    customSymbols,
    excludeAmbiguous,
    length,
    useCustomSymbols,
    useLower,
    useNumbers,
    useSymbols,
    useUpper,
  ]);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(passwords.join('\n'));
    setCopied(true);
    message.success(t('password.copied'));
    setTimeout(() => setCopied(false), 2000);
  };

  const strength = getStrength(passwords[0] || '');

  return (
    <Flexbox gap={24}>
      <Typography.Title className={styles.title} level={4}>
        {t('password.title')}
      </Typography.Title>

      <Flexbox className={styles.card} gap={20}>
        {/* Length */}
        <Flexbox align={'center'} gap={16} horizontal>
          <span className={styles.label}>{t('password.length')}</span>
          <Flexbox flex={1}>
            <Slider max={128} min={8} onChange={setLength} value={length} />
          </Flexbox>
          <InputNumber
            max={128}
            min={8}
            onChange={(v) => v && setLength(v)}
            size={'small'}
            style={{ width: 70 }}
            value={length}
          />
        </Flexbox>

        <Divider style={{ margin: '4px 0' }} />

        {/* Character sets */}
        <Flexbox gap={12}>
          <span className={styles.label}>{t('password.charsets')}</span>
          <Flexbox gap={10} wrap={'wrap'}>
            <Checkbox checked={useUpper} onChange={(e) => setUseUpper(e.target.checked)}>
              {t('password.uppercase')} <Typography.Text code>A–Z</Typography.Text>
            </Checkbox>
            <Checkbox checked={useLower} onChange={(e) => setUseLower(e.target.checked)}>
              {t('password.lowercase')} <Typography.Text code>a–z</Typography.Text>
            </Checkbox>
            <Checkbox checked={useNumbers} onChange={(e) => setUseNumbers(e.target.checked)}>
              {t('password.numbers')} <Typography.Text code>0–9</Typography.Text>
            </Checkbox>
            <Checkbox checked={useSymbols} onChange={(e) => setUseSymbols(e.target.checked)}>
              {t('password.symbols')} <Typography.Text code>!@#…</Typography.Text>
            </Checkbox>
          </Flexbox>
        </Flexbox>

        {/* Custom symbols */}
        {useSymbols && (
          <Flexbox align={'center'} gap={12} horizontal>
            <Checkbox
              checked={useCustomSymbols}
              onChange={(e) => setUseCustomSymbols(e.target.checked)}
            >
              {t('password.customSymbols')}
            </Checkbox>
            {useCustomSymbols && (
              <Input
                onChange={(e) => setCustomSymbols(e.target.value)}
                placeholder={'!@#$%^&*'}
                size={'small'}
                style={{ width: 200 }}
                value={customSymbols}
              />
            )}
          </Flexbox>
        )}

        {/* Exclude ambiguous */}
        <Checkbox
          checked={excludeAmbiguous}
          onChange={(e) => setExcludeAmbiguous(e.target.checked)}
        >
          {t('password.excludeAmbiguous')}{' '}
          <Typography.Text code type={'secondary'}>
            0 O l 1 I
          </Typography.Text>
        </Checkbox>

        <Divider style={{ margin: '4px 0' }} />

        {/* Count */}
        <Flexbox align={'center'} gap={16} horizontal>
          <span className={styles.label}>{t('password.count')}</span>
          <InputNumber
            max={20}
            min={1}
            onChange={(v) => v && setCount(v)}
            size={'small'}
            style={{ width: 70 }}
            value={count}
          />
        </Flexbox>

        <Button block icon={<RefreshCw size={14} />} onClick={generate} type={'primary'}>
          {t('password.generate')}
        </Button>
      </Flexbox>

      {/* Output */}
      {passwords.length > 0 && (
        <Flexbox className={styles.card} gap={12}>
          <Flexbox align={'center'} horizontal justify={'space-between'}>
            <Flexbox align={'center'} gap={8} horizontal>
              <Typography.Text strong>{t('password.result')}</Typography.Text>
              {passwords.length === 1 && strength.label && (
                <Tag className={styles.strength} color={strength.color as any}>
                  {strength.label}
                </Tag>
              )}
            </Flexbox>
            <Tooltip title={t('password.copy')}>
              <ActionIcon
                icon={copied ? Check : Copy}
                onClick={handleCopy}
                size={{ blockSize: 28, size: 14 }}
              />
            </Tooltip>
          </Flexbox>
          {passwords.map((pw, i) => (
            <Typography.Text className={styles.output} key={i}>
              {pw}
            </Typography.Text>
          ))}
        </Flexbox>
      )}
    </Flexbox>
  );
});

PasswordWorkspace.displayName = 'PasswordWorkspace';

export default PasswordWorkspace;
