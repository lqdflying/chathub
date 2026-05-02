'use client';

import { Form } from '@lobehub/ui';
import { Typography } from 'antd';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

const { Paragraph } = Typography;

const McpManagement = memo(() => {
  const { t } = useTranslation('setting');

  return (
    <Form.Group
      style={{ maxWidth: '1024px', width: '100%' }}
      title={t('tab.mcp-management')}
      variant={'borderless'}
    >
      <Paragraph type="secondary">
        {t('mcpManagement.description')}
      </Paragraph>
    </Form.Group>
  );
});

McpManagement.displayName = 'McpManagement';

export default McpManagement;
