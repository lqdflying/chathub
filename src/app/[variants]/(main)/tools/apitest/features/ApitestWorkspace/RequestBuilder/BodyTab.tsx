'use client';

import { App, Button, Input, Select, Typography } from 'antd';
import { createStyles } from 'antd-style';
import { memo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Flexbox } from 'react-layout-kit';

import { BODY_METHODS, CONTENT_TYPES } from '../constants';
import { formatJson } from '../helpers';

const useStyles = createStyles(({ css, token }) => ({
  label: css`
    min-width: 120px;
    font-size: 13px;
    color: ${token.colorTextSecondary};
  `,
  textarea: css`
    resize: vertical;
    font-family: ${token.fontFamilyCode};
    font-size: 13px;
  `,
}));

interface BodyTabProps {
  body: string;
  contentType: string;
  method: string;
  onChange: (patch: { body?: string; contentType?: string }) => void;
}

const BodyTab = memo<BodyTabProps>(({ body, contentType, method, onChange }) => {
  const { styles } = useStyles();
  const { t } = useTranslation('tools');
  const { message } = App.useApp();

  const handleFormatJson = useCallback(() => {
    try {
      onChange({ body: formatJson(body) });
    } catch {
      message.error(t('apitest.formatError'));
    }
  }, [body, message, onChange, t]);

  if (!BODY_METHODS.has(method)) {
    return (
      <Flexbox gap={12} style={{ padding: '16px 0' }}>
        <Typography.Text style={{ fontSize: 13 }} type={'secondary'}>
          {t('apitest.bodyUnavailable')}
        </Typography.Text>
      </Flexbox>
    );
  }

  return (
    <Flexbox gap={12} style={{ padding: '16px 0' }}>
      <Flexbox align={'center'} gap={12} horizontal>
        <span className={styles.label}>{t('apitest.contentType')}</span>
        <Select
          onChange={(value) => onChange({ contentType: value })}
          options={CONTENT_TYPES}
          size={'small'}
          style={{ width: 280 }}
          value={contentType}
        />
        <Button onClick={handleFormatJson} size={'small'} type={'dashed'}>
          {t('apitest.formatJson')}
        </Button>
      </Flexbox>
      <Input.TextArea
        className={styles.textarea}
        onChange={(e) => onChange({ body: e.target.value })}
        placeholder={'{"key": "value"}'}
        rows={10}
        value={body}
      />
    </Flexbox>
  );
});

BodyTab.displayName = 'BodyTab';

export default BodyTab;
