'use client';

import { Button } from '@lobehub/ui';
import type { inferRouterOutputs } from '@trpc/server';
import { Input } from 'antd';
import { createStyles } from 'antd-style';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Flexbox } from 'react-layout-kit';

import type { ProviderUsageAdminProvider } from '@/const/providerUsage';
import { lambdaQuery } from '@/libs/trpc/client';
import type { LambdaRouter } from '@/server/routers/lambda';

const MIN_KEY_LENGTH = 8;

const useStyles = createStyles(({ css, token }) => ({
  hint: css`
    min-width: 0;
    overflow-wrap: anywhere;
    color: ${token.colorTextSecondary};
    font-size: 12px;
    line-height: 1.6;
  `,
  row: css`
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    align-items: center;
    justify-content: space-between;

    width: 100%;
    min-width: 0;
  `,
  stored: css`
    min-width: 0;
    overflow-wrap: anywhere;
    color: ${token.colorText};
    font-size: 13px;
  `,
  sub: css`
    min-width: 0;
    overflow-wrap: anywhere;
    color: ${token.colorTextDescription};
    font-size: 12px;
    line-height: 1.4;
  `,
}));

type StoredCredential = { keyHint: string; teamId?: string };

export type ProviderUsageResult = inferRouterOutputs<LambdaRouter>['providerUsage']['get'];

interface AdminKeyFormProps {
  accountScope: string;
  disabled?: boolean;
  onSaved: (snapshot: ProviderUsageResult) => void;
  provider: ProviderUsageAdminProvider;
  stored?: StoredCredential;
}

/**
 * Admin / management keys go to a server-only table and are never sent back
 * to the browser; the form only ever shows the saved key's hint.
 */
const AdminKeyForm = memo<AdminKeyFormProps>(
  ({ accountScope, disabled, onSaved, provider, stored }) => {
    const { styles } = useStyles();
    const { t } = useTranslation('modelProvider');
    const [apiKey, setApiKey] = useState('');
    const [teamId, setTeamId] = useState('');
    const [failed, setFailed] = useState(false);
    const save = lambdaQuery.providerUsage.saveAdminCredential.useMutation();
    const remove = lambdaQuery.providerUsage.deleteAdminCredential.useMutation();
    const needsTeamId = provider === 'xai';

    const handleSave = async () => {
      setFailed(false);
      try {
        const next = await save.mutateAsync({
          accountScope,
          apiKey: apiKey.trim(),
          provider,
          ...(needsTeamId && teamId.trim() ? { teamId: teamId.trim() } : {}),
        });
        if (next?.storedCredential) {
          setApiKey('');
          setTeamId('');
        }
        onSaved(next);
      } catch {
        setFailed(true);
      }
    };

    const handleRemove = async () => {
      setFailed(false);
      try {
        onSaved(await remove.mutateAsync({ accountScope, provider }));
      } catch {
        setFailed(true);
      }
    };

    if (stored) {
      return (
        <Flexbox gap={4}>
          <div className={styles.row}>
            <span className={styles.stored}>
              {t('providerUsage.admin.stored', { hint: stored.keyHint })}
              {stored.teamId
                ? ` · ${t('providerUsage.admin.team', { teamId: stored.teamId })}`
                : ''}
            </span>
            <Button
              disabled={disabled}
              loading={remove.isPending}
              onClick={() => void handleRemove()}
              size={'small'}
            >
              {t('providerUsage.admin.remove')}
            </Button>
          </div>
          <div className={styles.sub}>{t('providerUsage.admin.storedHint')}</div>
          {failed && <div className={styles.hint}>{t('providerUsage.admin.saveFailed')}</div>}
        </Flexbox>
      );
    }

    return (
      <Flexbox gap={8}>
        <div className={styles.hint}>{t(`providerUsage.admin.desc.${provider}`)}</div>
        <Input.Password
          aria-label={t(`providerUsage.admin.keyLabel.${provider}`)}
          autoComplete={'off'}
          disabled={disabled}
          onChange={(event) => setApiKey(event.target.value)}
          placeholder={t(`providerUsage.admin.keyLabel.${provider}`)}
          value={apiKey}
        />
        {needsTeamId && (
          <Input
            aria-label={t('providerUsage.admin.teamIdPlaceholder')}
            autoComplete={'off'}
            disabled={disabled}
            onChange={(event) => setTeamId(event.target.value)}
            placeholder={t('providerUsage.admin.teamIdPlaceholder')}
            value={teamId}
          />
        )}
        <div className={styles.row}>
          <span className={styles.sub}>{t('providerUsage.admin.storedHint')}</span>
          <Button
            disabled={disabled || apiKey.trim().length < MIN_KEY_LENGTH}
            loading={save.isPending}
            onClick={() => void handleSave()}
            size={'small'}
            type={'primary'}
          >
            {t('providerUsage.admin.save')}
          </Button>
        </div>
        {failed && <div className={styles.hint}>{t('providerUsage.admin.saveFailed')}</div>}
      </Flexbox>
    );
  },
);

AdminKeyForm.displayName = 'ProviderUsageAdminKeyForm';

export default AdminKeyForm;
