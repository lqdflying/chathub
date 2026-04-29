import { Suspense } from 'react';
import { Spin } from 'antd';
import { Center } from 'react-layout-kit';
import { Card } from 'antd';

import CallbackContent from './CallbackContent';

const McpOAuthCallbackPage = () => {
  return (
    <Suspense
      fallback={
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
            <Spin size="large" />
          </Card>
        </Center>
      }
    >
      <CallbackContent />
    </Suspense>
  );
};

McpOAuthCallbackPage.displayName = 'McpOAuthCallbackPage';

export default McpOAuthCallbackPage;
