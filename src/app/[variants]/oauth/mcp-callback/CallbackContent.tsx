'use client';

import { Icon } from '@lobehub/ui';
import { Card, Result, Spin } from 'antd';
import { CheckCircle, XCircle } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Center } from 'react-layout-kit';

import { toolsClient } from '@/libs/trpc/client';

const pageTitle = 'MCP OAuth Callback';

const CallbackContent = () => {
  const searchParams = useSearchParams();
  const router = useRouter();
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

        setStatus('success');

        setTimeout(() => {
          sessionStorage.removeItem('mcpOAuthPluginId');
          // Redirect to /chat — the Plugin Store will auto-open with the
          // pending plugin editor (resume data was saved before OAuth redirect).
          router.push('/chat');
        }, 2000);
      } catch (err) {
        // Clean up resume state on error
        sessionStorage.removeItem('mcpOAuthResumeEdit');
        sessionStorage.removeItem('mcpOAuthOpenDevModal');
        sessionStorage.removeItem('mcpOAuthPluginId');
        setStatus('error');
        setErrorMsg((err as Error).message || 'Unknown error');
      }
    };

    if (error) {
      setStatus('error');
      setErrorMsg(errorDescription || error || 'Authorization was denied');
    } else if (code && state) {
      handleCallback();
    } else {
      setStatus('error');
      setErrorMsg('Missing authorization code or state parameter');
    }
  }, [searchParams, router]);

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
          subTitle="OAuth authorization complete. Redirecting..."
          title="Authorization Successful"
        />
      </Card>
    </Center>
  );
};

CallbackContent.displayName = pageTitle;

export default CallbackContent;
