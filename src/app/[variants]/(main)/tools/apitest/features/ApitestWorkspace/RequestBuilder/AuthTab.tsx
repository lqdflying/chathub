'use client';

import { Input, Radio } from 'antd';
import { createStyles } from 'antd-style';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { Flexbox } from 'react-layout-kit';

import type { ApiTesterRequestDraft } from '../types';

const useStyles = createStyles(({ css, token }) => ({
  label: css`
    min-width: 120px;
    font-size: 13px;
    color: ${token.colorTextSecondary};
  `,
}));

interface AuthTabProps {
  draft: ApiTesterRequestDraft;
  onChange: (patch: Partial<ApiTesterRequestDraft>) => void;
}

const AuthTab = memo<AuthTabProps>(({ draft, onChange }) => {
  const { styles } = useStyles();
  const { t } = useTranslation('tools');

  return (
    <Flexbox gap={16} style={{ padding: '16px 0' }}>
      <Flexbox align={'center'} gap={12} horizontal>
        <span className={styles.label}>{t('apitest.authType')}</span>
        <Radio.Group
          onChange={(e) => onChange({ authType: e.target.value })}
          options={[
            { label: t('apitest.authNone'), value: 'none' },
            { label: t('apitest.authBearer'), value: 'bearer' },
            { label: t('apitest.authBasic'), value: 'basic' },
            { label: t('apitest.authApiKey'), value: 'apikey' },
          ]}
          value={draft.authType}
        />
      </Flexbox>

      {draft.authType === 'bearer' && (
        <Flexbox align={'center'} gap={12} horizontal>
          <span className={styles.label}>{t('apitest.token')}</span>
          <Input.Password
            onChange={(e) => onChange({ bearerToken: e.target.value })}
            placeholder={'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...'}
            style={{ flex: 1, fontFamily: 'monospace' }}
            value={draft.bearerToken}
          />
        </Flexbox>
      )}

      {draft.authType === 'basic' && (
        <>
          <Flexbox align={'center'} gap={12} horizontal>
            <span className={styles.label}>{t('apitest.username')}</span>
            <Input
              onChange={(e) => onChange({ basicUsername: e.target.value })}
              placeholder={'username'}
              style={{ flex: 1 }}
              value={draft.basicUsername}
            />
          </Flexbox>
          <Flexbox align={'center'} gap={12} horizontal>
            <span className={styles.label}>{t('apitest.password')}</span>
            <Input.Password
              onChange={(e) => onChange({ basicPassword: e.target.value })}
              placeholder={'password'}
              style={{ flex: 1 }}
              value={draft.basicPassword}
            />
          </Flexbox>
        </>
      )}

      {draft.authType === 'apikey' && (
        <>
          <Flexbox align={'center'} gap={12} horizontal>
            <span className={styles.label}>{t('apitest.apiKeyName')}</span>
            <Input
              onChange={(e) => onChange({ apiKeyName: e.target.value })}
              placeholder={'X-Api-Key'}
              style={{ flex: 1, fontFamily: 'monospace' }}
              value={draft.apiKeyName}
            />
          </Flexbox>
          <Flexbox align={'center'} gap={12} horizontal>
            <span className={styles.label}>{t('apitest.apiKeyValue')}</span>
            <Input.Password
              onChange={(e) => onChange({ apiKeyValue: e.target.value })}
              placeholder={'secret'}
              style={{ flex: 1, fontFamily: 'monospace' }}
              value={draft.apiKeyValue}
            />
          </Flexbox>
          <Flexbox align={'center'} gap={12} horizontal>
            <span className={styles.label}>{t('apitest.apiKeyAddTo')}</span>
            <Radio.Group
              onChange={(e) => onChange({ apiKeyLocation: e.target.value })}
              options={[
                { label: t('apitest.apiKeyInHeader'), value: 'header' },
                { label: t('apitest.apiKeyInQuery'), value: 'query' },
              ]}
              value={draft.apiKeyLocation}
            />
          </Flexbox>
        </>
      )}
    </Flexbox>
  );
});

AuthTab.displayName = 'AuthTab';

export default AuthTab;
