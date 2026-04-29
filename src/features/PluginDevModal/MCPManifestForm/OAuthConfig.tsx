import { FormItem } from '@lobehub/ui';
import { Alert, Button, FormInstance, Space, Tag, Typography } from 'antd';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { toolsClient } from '@/libs/trpc/client';

interface OAuthConfigProps {
  form: FormInstance;
  identifier?: string;
}

type OAuthTokenStatus = 'valid' | 'expired' | 'missing' | 'refreshing' | 'error';

const OAuthConfig = ({ form, identifier }: OAuthConfigProps) => {
  const { t } = useTranslation('plugin');
  const [discovering, setDiscovering] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [tokenStatus, setTokenStatus] = useState<OAuthTokenStatus>('missing');
  const [error, setError] = useState<string | null>(null);
  const [discovered, setDiscovered] = useState(false);

  /**
   * Auto-discover OAuth metadata from the MCP server, then redirect for authorization.
   * The user only needs the server URL — Client ID, Client Secret, endpoints are all auto-discovered.
   */
  const handleConnect = async () => {
    setDiscovering(true);
    setError(null);

    try {
      const values = form.getFieldsValue();
      const mcp = values.customParams?.mcp;

      if (!mcp?.url) {
        setError(t('dev.mcp.url.required') || 'Please enter the MCP server URL');
        setDiscovering(false);
        return;
      }

      const pluginId = identifier || values.identifier;
      const redirectUri = `${window.location.origin}/oauth/mcp-callback`;

      // Step 1: Auto-discover OAuth metadata from the MCP server's well-known endpoints
      const metadata = await toolsClient.mcpOAuth.discoverOAuth.mutate({
        serverUrl: mcp.url,
        clientName: pluginId || 'LobeChat MCP Client',
        redirectUri,
      });

      if (!metadata.clientId) {
        setError(
          t('dev.mcp.auth.oauthConfig.autoDiscoveryNoClientId') ||
            'This server does not support dynamic client registration. Contact the server admin or set up OAuth credentials manually.',
        );
        setDiscovering(false);
        return;
      }

      // Store the discovered client info in the form
      form.setFieldsValue({
        customParams: {
          ...values.customParams,
          mcp: {
            ...mcp,
            auth: {
              ...mcp.auth,
              authorizationEndpoint: metadata.authorizationEndpoint,
              tokenEndpoint: metadata.tokenEndpoint,
              clientId: metadata.clientId,
              clientSecret: metadata.clientSecret,
              scope: metadata.scopesSupported?.join(' ') || mcp.auth?.scope,
            },
          },
        },
      });

      setDiscovered(true);
      setDiscovering(false);
      setConnecting(true);

      // Store the state in sessionStorage so the callback page can verify
      sessionStorage.setItem('mcpOAuthPluginId', pluginId);

      // Step 2: Initiate OAuth with discovered metadata
      const result = await toolsClient.mcpOAuth.initiateOAuth.mutate({
        authorizationEndpoint: metadata.authorizationEndpoint,
        clientId: metadata.clientId,
        clientSecret: metadata.clientSecret,
        pluginIdentifier: pluginId,
        redirectUri,
        scope: metadata.scopesSupported?.join(' ') || mcp.auth?.scope,
        tokenEndpoint: metadata.tokenEndpoint,
      });

      // Step 3: Redirect to the authorization endpoint
      window.location.href = result.authorizeUrl;
    } catch (err) {
      setError(
        (err as Error).message ||
          t('dev.mcp.auth.oauthConfig.connectFailed') ||
          'OAuth connection failed',
      );
      setDiscovering(false);
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
      <Typography.Paragraph
        style={{ fontSize: 13, marginBottom: 12 }}
        type="secondary"
      >
        {t('dev.mcp.auth.oauthConfig.autoDiscoveryDesc') ||
          'OAuth metadata will be auto-discovered from the MCP server using well-known endpoints. Just click the button below.'}
      </Typography.Paragraph>

      <Space direction="vertical" style={{ width: '100%', marginBottom: 16 }}>
        <Space>
          <Button
            loading={discovering || connecting}
            type="primary"
            onClick={handleConnect}
          >
            {discovering
              ? t('dev.mcp.auth.oauthConfig.discovering') || 'Discovering...'
              : t('dev.mcp.auth.oauthConfig.connectButton') || 'Connect with OAuth'}
          </Button>
          {tokenStatus !== 'missing' && (
            <>
              <Button onClick={handleCheckStatus} size="small">
                {t('dev.mcp.auth.oauthConfig.checkStatus') || 'Check Status'}
              </Button>
              <Button danger onClick={handleDisconnect} size="small">
                {t('dev.mcp.auth.oauthConfig.disconnect') || 'Disconnect'}
              </Button>
            </>
          )}
        </Space>
        {discovered && (
          <Tag color="blue">
            {t('dev.mcp.auth.oauthConfig.discovered') || 'OAuth endpoints discovered'}
          </Tag>
        )}
        {tokenStatus !== 'missing' && (
          <Tag color={statusTagColor}>
            {t('dev.mcp.auth.oauthConfig.statusLabel') || 'Status'}: {tokenStatus}
          </Tag>
        )}
      </Space>

      {/* Hidden fields to store discovered metadata in the form */}
      <FormItem hidden name={['customParams', 'mcp', 'auth', 'authorizationEndpoint']}>
        <input type="hidden" />
      </FormItem>
      <FormItem hidden name={['customParams', 'mcp', 'auth', 'tokenEndpoint']}>
        <input type="hidden" />
      </FormItem>
      <FormItem hidden name={['customParams', 'mcp', 'auth', 'clientId']}>
        <input type="hidden" />
      </FormItem>
      <FormItem hidden name={['customParams', 'mcp', 'auth', 'clientSecret']}>
        <input type="hidden" />
      </FormItem>

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
