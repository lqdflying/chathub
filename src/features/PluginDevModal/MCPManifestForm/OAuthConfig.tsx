import { FormItem, Input, InputPassword } from '@lobehub/ui';
import { Alert, Button, FormInstance, Space, Tag } from 'antd';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { toolsClient } from '@/libs/trpc/client';

interface OAuthConfigProps {
  form: FormInstance;
  identifier?: string;
}

type OAuthTokenStatus = 'valid' | 'expired' | 'missing' | 'refreshing' | 'error';

const OAUTH_CLIENT_ID = ['customParams', 'mcp', 'auth', 'clientId'];
const OAUTH_CLIENT_SECRET = ['customParams', 'mcp', 'auth', 'clientSecret'];
const OAUTH_AUTH_ENDPOINT = ['customParams', 'mcp', 'auth', 'authorizationEndpoint'];
const OAUTH_TOKEN_ENDPOINT = ['customParams', 'mcp', 'auth', 'tokenEndpoint'];
const OAUTH_SCOPE = ['customParams', 'mcp', 'auth', 'scope'];

const OAuthConfig = ({ form, identifier }: OAuthConfigProps) => {
  const { t } = useTranslation('plugin');
  const [connecting, setConnecting] = useState(false);
  const [tokenStatus, setTokenStatus] = useState<OAuthTokenStatus>('missing');
  const [error, setError] = useState<string | null>(null);

  const handleConnect = async () => {
    setConnecting(true);
    setError(null);

    try {
      const values = form.getFieldsValue();
      const auth = values.customParams?.mcp?.auth;

      if (!auth?.authorizationEndpoint || !auth?.tokenEndpoint || !auth?.clientId) {
        setError(t('dev.mcp.auth.oauthConfig.missingFields') || 'Please fill in all OAuth fields');
        setConnecting(false);
        return;
      }

      const pluginId = identifier || values.identifier;
      const redirectUri = `${window.location.origin}/oauth/mcp-callback`;

      const result = await toolsClient.mcpOAuth.initiateOAuth.mutate({
        authorizationEndpoint: auth.authorizationEndpoint,
        clientId: auth.clientId,
        pluginIdentifier: pluginId,
        redirectUri,
        scope: auth.scope,
        tokenEndpoint: auth.tokenEndpoint,
      });

      // Store the state in sessionStorage so the callback page can verify
      sessionStorage.setItem('mcpOAuthPluginId', pluginId);

      // Redirect the user to the authorization endpoint
      window.location.href = result.authorizeUrl;
    } catch (err) {
      setError((err as Error).message || t('dev.mcp.auth.oauthConfig.connectFailed'));
      setConnecting(false);
    }
  };

  const handleDisconnect = async () => {
    try {
      const values = form.getFieldsValue();
      const pluginId = identifier || values.identifier;

      await toolsClient.mcpOAuth.revokeOAuthToken.mutate({
        pluginIdentifier: pluginId,
      });

      setTokenStatus('missing');
      form.setFieldsValue({
        customParams: {
          ...values.customParams,
          mcp: {
            ...values.customParams?.mcp,
            auth: {
              ...values.customParams?.mcp?.auth,
              accessToken: undefined,
              refreshToken: undefined,
            },
          },
        },
      });
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const handleCheckStatus = async () => {
    try {
      const values = form.getFieldsValue();
      const pluginId = identifier || values.identifier;

      const status = await toolsClient.mcpOAuth.getOAuthStatus.query({
        pluginIdentifier: pluginId,
      });

      setTokenStatus(status as OAuthTokenStatus);
    } catch (err) {
      setTokenStatus('error');
    }
  };

  const statusTagColor = {
    missing: 'default',
    valid: 'green',
    expired: 'orange',
    refreshing: 'blue',
    error: 'red',
  }[tokenStatus];

  return (
    <>
      <FormItem
        desc={t('dev.mcp.auth.oauthConfig.clientId.desc')}
        label={t('dev.mcp.auth.oauthConfig.clientId.label')}
        name={OAUTH_CLIENT_ID}
      >
        <Input placeholder={t('dev.mcp.auth.oauthConfig.clientId.placeholder')} />
      </FormItem>

      <FormItem
        desc={t('dev.mcp.auth.oauthConfig.clientSecret.desc')}
        label={t('dev.mcp.auth.oauthConfig.clientSecret.label')}
        name={OAUTH_CLIENT_SECRET}
      >
        <InputPassword placeholder={t('dev.mcp.auth.oauthConfig.clientSecret.placeholder')} />
      </FormItem>

      <FormItem
        desc={t('dev.mcp.auth.oauthConfig.authorizationEndpoint.desc')}
        label={t('dev.mcp.auth.oauthConfig.authorizationEndpoint.label')}
        name={OAUTH_AUTH_ENDPOINT}
      >
        <Input placeholder="https://auth.example.com/authorize" />
      </FormItem>

      <FormItem
        desc={t('dev.mcp.auth.oauthConfig.tokenEndpoint.desc')}
        label={t('dev.mcp.auth.oauthConfig.tokenEndpoint.label')}
        name={OAUTH_TOKEN_ENDPOINT}
      >
        <Input placeholder="https://auth.example.com/token" />
      </FormItem>

      <FormItem
        desc={t('dev.mcp.auth.oauthConfig.scope.desc')}
        label={t('dev.mcp.auth.oauthConfig.scope.label')}
        name={OAUTH_SCOPE}
      >
        <Input placeholder="openid profile read write" />
      </FormItem>

      <Space direction="vertical" style={{ width: '100%', marginBottom: 16 }}>
        <Space>
          <Button loading={connecting} type="primary" onClick={handleConnect}>
            {t('dev.mcp.auth.oauthConfig.connectButton')}
          </Button>
          <Button onClick={handleCheckStatus} size="small">
            {t('dev.mcp.auth.oauthConfig.checkStatus')}
          </Button>
          {tokenStatus !== 'missing' && (
            <Button danger onClick={handleDisconnect} size="small">
              {t('dev.mcp.auth.oauthConfig.disconnect')}
            </Button>
          )}
        </Space>
        {tokenStatus !== 'missing' && (
          <Tag color={statusTagColor}>
            {t('dev.mcp.auth.oauthConfig.statusLabel')}: {tokenStatus}
          </Tag>
        )}
      </Space>

      {error && (
        <Alert
          closable
          message={error}
          onClose={() => setError(null)}
          showIcon
          style={{ marginBottom: 16 }}
          type="error"
        />
      )}
    </>
  );
};

export default OAuthConfig;
