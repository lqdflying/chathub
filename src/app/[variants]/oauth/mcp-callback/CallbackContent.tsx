'use client';

import { Icon } from '@lobehub/ui';
import { Card, Result, Spin } from 'antd';
import { CheckCircle, XCircle } from 'lucide-react';
import { useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Center } from 'react-layout-kit';

import { toolsClient } from '@/libs/trpc/client';

const pageTitle = 'MCP OAuth Callback';

const notifyOpener = (data: Record<string, unknown>) => {
  if (window.opener) {
    window.opener.postMessage({ ...data, source: 'mcp-oauth' }, window.location.origin);
  }
};

const CallbackContent = () => {
  const searchParams = useSearchParams();
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading');
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    const code = searchParams.get('code');
    const state = searchParams.get('state');
    const error = searchParams.get('error');
    const errorDescription = searchParams.get('error_description');

    const handleCallback = async () => {
      try {
        await toolsClient.mcpOAuth.oauthCallback.mutate({
          code: code || '',
          error: error || undefined,
          error_description: errorDescription || undefined,
          state: state || '',
        });

        // Notify the opener (the Plugin Editor page) that OAuth succeeded.
        // The opener can then check the token status and close this popup.
        notifyOpener({ type: 'success' });

        setStatus('success');

        // Auto-close the popup after a short delay so the user sees the success
        setTimeout(() => {
          window.close();
        }, 1500);
      } catch (err) {
        notifyOpener({
          error: (err as Error).message || 'Unknown error',
          type: 'error',
        });

        setStatus('error');
        setErrorMsg((err as Error).message || 'Unknown error');
      }
    };

    if (error) {
      notifyOpener({
        error: errorDescription || error || 'Authorization was denied',
        type: 'error',
      });
      setStatus('error');
      setErrorMsg(errorDescription || error || 'Authorization was denied');
    } else if (code && state) {
      handleCallback();
    } else {
      notifyOpener({
        error: 'Missing authorization code or state parameter',
        type: 'error',
      });
      setStatus('error');
      setErrorMsg('Missing authorization code or state parameter');
    }
  }, [searchParams]);

  if (status === 'loading') {
    return (
      <Center height="100vh">
        <Card
          style={{
            alignItems: 'center',
            display: 'flex',
            justifyContent: 'center',
            minHeight: 280,
            minWidth: 500,
            width: '100%',
          }}
        >
          <Spin size="large" tip="Processing OAuth authorization..." />
        </Card>
      </Center>
    );
  }

  if (status === 'error') {
    return (
      <Center height="100vh">
        <Card
          style={{
            alignItems: 'center',
            display: 'flex',
            justifyContent: 'center',
            minHeight: 280,
            minWidth: 500,
            width: '100%',
          }}
        >
          <Result
            icon={<Icon icon={XCircle} />}
            status="error"
            subTitle={errorMsg}
            title="Authorization Failed"
          />
        </Card>
      </Center>
    );
  }

  return (
    <Center height="100vh">
      <Card
        style={{
          alignItems: 'center',
          display: 'flex',
          justifyContent: 'center',
          minHeight: 280,
          minWidth: 500,
          width: '100%',
        }}
      >
        <Result
          icon={<Icon icon={CheckCircle} />}
          status="success"
          subTitle="OAuth authorization complete. This window will close automatically."
          title="Authorization Successful"
        />
      </Card>
    </Center>
  );
};

CallbackContent.displayName = pageTitle;

export default CallbackContent;
