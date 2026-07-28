'use client';

import { Button, Text } from '@lobehub/ui';
import { Alert, Flex, Input, Tabs } from 'antd';
import { createStyles } from 'antd-style';
import { signIn } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import React, { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { normalizeAuthRedirect } from '@/helpers/normalizeAuthRedirect';
import { runNextAuthSessionTransition } from '@/libs/next-auth/sessionLifecycle';

const useStyles = createStyles(({ css }) => ({
  form: css`
    width: 100%;
  `,
  input: css`
    width: 100%;
  `,
  tab: css`
    .ant-tabs-nav {
      margin-block-end: 12px;
    }
  `,
}));

interface CredentialsFormProps {
  callbackUrl: string;
}

export default memo<CredentialsFormProps>(({ callbackUrl }) => {
  const { styles } = useStyles();
  const { t } = useTranslation('auth');
  const router = useRouter();

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [token, setToken] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState('password');

  const handlePasswordLogin = async () => {
    if (!username || !password) {
      setError(t('credentials.errorEmpty'));
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const result = await runNextAuthSessionTransition(() =>
        signIn('credentials', {
          password,
          redirect: false,
          redirectTo: callbackUrl,
          token: '',
          username,
        }),
      );

      if (result?.error) {
        setError(t('credentials.errorInvalid'));
      } else {
        router.push(normalizeAuthRedirect(result?.url ?? undefined, '/'));
      }
    } catch {
      setError(t('credentials.errorInvalid'));
    } finally {
      setLoading(false);
    }
  };

  const handleTokenLogin = async () => {
    if (!token) {
      setError(t('credentials.errorEmptyToken'));
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const result = await runNextAuthSessionTransition(() =>
        signIn('credentials', {
          password: '',
          redirect: false,
          redirectTo: callbackUrl,
          token,
          username: '',
        }),
      );

      if (result?.error) {
        setError(t('credentials.errorInvalidToken'));
      } else {
        router.push(normalizeAuthRedirect(result?.url ?? undefined, '/'));
      }
    } catch {
      setError(t('credentials.errorInvalidToken'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Flex className={styles.form} gap="small" vertical>
      <Tabs
        activeKey={activeTab}
        centered
        className={styles.tab}
        items={[
          {
            children: (
              <Flex gap="small" vertical>
                <Text as={'label'}>{t('credentials.username')}</Text>
                <Input
                  className={styles.input}
                  onChange={(e) => setUsername(e.target.value)}
                  onPressEnter={handlePasswordLogin}
                  placeholder={t('credentials.usernamePlaceholder')}
                  value={username}
                />
                <Text as={'label'}>{t('credentials.password')}</Text>
                <Input.Password
                  className={styles.input}
                  onChange={(e) => setPassword(e.target.value)}
                  onPressEnter={handlePasswordLogin}
                  placeholder={t('credentials.passwordPlaceholder')}
                  value={password}
                />
                <Button block loading={loading} onClick={handlePasswordLogin} type="primary">
                  {t('credentials.signIn')}
                </Button>
              </Flex>
            ),
            key: 'password',
            label: t('credentials.tabPassword'),
          },
          {
            children: (
              <Flex gap="small" vertical>
                <Text as={'label'}>{t('credentials.token')}</Text>
                <Input.Password
                  className={styles.input}
                  onChange={(e) => setToken(e.target.value)}
                  onPressEnter={handleTokenLogin}
                  placeholder={t('credentials.tokenPlaceholder')}
                  value={token}
                />
                <Button block loading={loading} onClick={handleTokenLogin} type="primary">
                  {t('credentials.signIn')}
                </Button>
              </Flex>
            ),
            key: 'token',
            label: t('credentials.tabToken'),
          },
        ]}
        onChange={setActiveTab}
        size="small"
      />
      {error && <Alert message={error} showIcon type="error" />}
    </Flex>
  );
});
