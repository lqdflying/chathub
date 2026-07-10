'use client';

import { ActionIcon, CopyButton, Highlighter } from '@lobehub/ui';
import { Alert, Segmented } from 'antd';
import { createStyles } from 'antd-style';
import { Download } from 'lucide-react';
import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Flexbox } from 'react-layout-kit';

import { HIGHLIGHT_MAX_CHARS, JSON_TREE_MAX_NODES } from '../constants';
import { detectHighlightLanguage } from '../helpers';
import type { ResponseState } from '../types';
import JsonTree from './JsonTree';
import { buildJsonTree, parseJsonValue } from './jsonTree';

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
  toolbar: css`
    flex-wrap: wrap;
    min-width: 0;
  `,
}));

interface ResponseBodyProps {
  response: ResponseState;
}

type ResponseViewMode = 'formatted' | 'raw' | 'tree';

const ResponseBody = memo<ResponseBodyProps>(({ response }) => {
  const { styles } = useStyles();
  const { t } = useTranslation('tools');
  const parsedJson = useMemo(
    () => (response.isJson ? parseJsonValue(response.body) : { parsed: false as const }),
    [response.body, response.isJson],
  );
  const formattedBody = useMemo(
    () =>
      parsedJson.parsed
        ? (JSON.stringify(parsedJson.value, null, 2) ?? response.body)
        : response.body,
    [parsedJson, response.body],
  );
  const jsonTreeResult = useMemo(
    () => (parsedJson.parsed ? buildJsonTree(parsedJson.value, JSON_TREE_MAX_NODES) : undefined),
    [parsedJson],
  );
  const jsonTreeData =
    jsonTreeResult && !jsonTreeResult.exceededLimit ? jsonTreeResult.data : undefined;
  const isJsonTreeTooLarge = jsonTreeResult?.exceededLimit === true;
  const [viewMode, setViewMode] = useState<ResponseViewMode>(() =>
    jsonTreeData ? 'tree' : 'formatted',
  );

  useEffect(() => {
    setViewMode(jsonTreeData ? 'tree' : 'formatted');
  }, [jsonTreeData, response]);

  const contentType = response.headers['content-type'] || response.headers['Content-Type'] || '';
  const language = useMemo(
    () => detectHighlightLanguage(contentType, response.body),
    [contentType, response.body],
  );

  const activeViewMode = viewMode === 'tree' && !jsonTreeData ? 'formatted' : viewMode;
  const displayBody = activeViewMode === 'raw' ? response.body : formattedBody;
  const canHighlight =
    activeViewMode === 'formatted' &&
    displayBody.length > 0 &&
    displayBody.length < HIGHLIGHT_MAX_CHARS;
  const viewOptions = [
    ...(jsonTreeData ? [{ label: t('apitest.jsonTree'), value: 'tree' as const }] : []),
    { label: t('apitest.formatted'), value: 'formatted' as const },
    { label: t('apitest.raw'), value: 'raw' as const },
  ];

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
      <Flexbox
        align={'center'}
        className={styles.toolbar}
        gap={8}
        horizontal
        justify={'space-between'}
      >
        <Segmented<ResponseViewMode>
          name="api-tester-response-view"
          onChange={setViewMode}
          options={viewOptions}
          size={'small'}
          value={activeViewMode}
        />
        <Flexbox align={'center'} gap={4} horizontal>
          <CopyButton content={displayBody} size={'small'} />
          <ActionIcon
            icon={Download}
            onClick={handleDownload}
            size={'small'}
            title={t('apitest.downloadResponse')}
          />
        </Flexbox>
      </Flexbox>
      {isJsonTreeTooLarge && (
        <Alert message={t('apitest.jsonTreeTooLarge')} showIcon type={'info'} />
      )}
      {activeViewMode === 'tree' && jsonTreeData ? (
        <JsonTree accessibleLabel={t('apitest.jsonTreeLabel')} data={jsonTreeData} />
      ) : canHighlight ? (
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
