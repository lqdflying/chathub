'use client';

import { ActionIcon, CopyButton, Highlighter } from '@lobehub/ui';
import { Button } from 'antd';
import { createStyles } from 'antd-style';
import { Download } from 'lucide-react';
import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Flexbox } from 'react-layout-kit';

import { HIGHLIGHT_MAX_CHARS } from '../constants';
import { detectHighlightLanguage } from '../helpers';
import type { ResponseState } from '../types';

const EXTENSION_BY_LANGUAGE: Record<string, string> = {
  html: 'html',
  json: 'json',
  text: 'txt',
  xml: 'xml',
};

const useStyles = createStyles(({ css, token }) => ({
  codeBlock: css`
    overflow: auto;

    max-height: 400px;
    margin: 0;
    padding: 12px;
    border-radius: ${token.borderRadius}px;

    font-family: ${token.fontFamilyCode};
    font-size: 13px;
    line-height: 1.6;
    word-break: break-all;
    white-space: pre-wrap;

    background: ${token.colorFillTertiary};
  `,
  errorBanner: css`
    padding: 12px;
    border: 1px solid ${token.colorErrorBorder};
    border-radius: ${token.borderRadius}px;

    font-family: ${token.fontFamilyCode};
    font-size: 13px;
    color: ${token.colorError};

    background: ${token.colorErrorBg};
  `,
  highlighter: css`
    overflow: auto;
    max-height: 400px;
    border-radius: ${token.borderRadius}px;
    background: ${token.colorFillTertiary};
  `,
}));

interface ResponseBodyProps {
  response: ResponseState;
}

const ResponseBody = memo<ResponseBodyProps>(({ response }) => {
  const { styles } = useStyles();
  const { t } = useTranslation('tools');
  const [rawMode, setRawMode] = useState(false);

  useEffect(() => {
    setRawMode(false);
  }, [response]);

  const formattedBody = useMemo(() => {
    if (!response.isJson || !response.body) return response.body;
    try {
      return JSON.stringify(JSON.parse(response.body), null, 2);
    } catch {
      return response.body;
    }
  }, [response]);

  const contentType = response.headers['content-type'] || response.headers['Content-Type'] || '';
  const language = useMemo(
    () => detectHighlightLanguage(contentType, response.body),
    [contentType, response.body],
  );

  const displayBody = rawMode ? response.body : formattedBody;
  const canHighlight =
    !rawMode && displayBody.length > 0 && displayBody.length < HIGHLIGHT_MAX_CHARS;

  const handleDownload = useCallback(() => {
    const blob = new Blob([response.body], { type: contentType || 'text/plain' });
    const objectUrl = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = objectUrl;
    anchor.download = `response.${EXTENSION_BY_LANGUAGE[language]}`;
    anchor.click();
    URL.revokeObjectURL(objectUrl);
  }, [contentType, language, response.body]);

  if (response.error) {
    return (
      <Flexbox gap={8} style={{ padding: '16px 0' }}>
        <div className={styles.errorBanner}>
          {t('apitest.networkError')}: {response.error}
        </div>
      </Flexbox>
    );
  }

  return (
    <Flexbox gap={8} style={{ padding: '16px 0' }}>
      <Flexbox align={'center'} gap={4} horizontal justify={'flex-end'}>
        <CopyButton content={displayBody} size={'small'} />
        <ActionIcon
          icon={Download}
          onClick={handleDownload}
          size={'small'}
          title={t('apitest.downloadResponse')}
        />
        <Button onClick={() => setRawMode((v) => !v)} size={'small'} type={'text'}>
          {rawMode ? t('apitest.formatted') : t('apitest.raw')}
        </Button>
      </Flexbox>
      {canHighlight ? (
        <div className={styles.highlighter}>
          <Highlighter language={language} variant={'borderless'} wrap>
            {displayBody}
          </Highlighter>
        </div>
      ) : (
        <pre className={styles.codeBlock}>{displayBody || t('apitest.emptyBody')}</pre>
      )}
    </Flexbox>
  );
});

ResponseBody.displayName = 'ResponseBody';

export default ResponseBody;
