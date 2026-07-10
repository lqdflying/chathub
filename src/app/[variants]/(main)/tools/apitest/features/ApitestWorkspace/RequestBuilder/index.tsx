'use client';

import { Button, Divider, Input, Select, Tabs, Tooltip } from 'antd';
import { createStyles } from 'antd-style';
import { History, Import, Send, Terminal, X } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { Flexbox } from 'react-layout-kit';

import { COMMON_HEADER_NAMES, HTTP_METHODS } from '../constants';
import type { ApiTesterRequestDraft, QueryParamRow } from '../types';
import { createHeaderRow, createParamRow } from '../types';
import AuthTab from './AuthTab';
import BodyTab from './BodyTab';
import KeyValueEditor from './KeyValueEditor';

const useStyles = createStyles(({ css, token }) => ({
  card: css`
    padding: 20px;
    border: 1px solid ${token.colorBorderSecondary};
    border-radius: ${token.borderRadiusLG}px;
    background: ${token.colorBgContainer};
  `,
  methodSelect: css`
    width: 120px;
    font-weight: 600;
  `,
  urlInput: css`
    flex: 1;
    font-family: ${token.fontFamilyCode};
    font-size: 13px;
  `,
}));

interface RequestBuilderProps {
  activeTab: string;
  draft: ApiTesterRequestDraft;
  loading: boolean;
  onCancel: () => void;
  onCopyCurl: () => void;
  onDraftChange: (patch: Partial<ApiTesterRequestDraft>) => void;
  onOpenHistory: () => void;
  onOpenImport: () => void;
  onParamsChange: (rows: QueryParamRow[]) => void;
  onSend: () => void;
  onTabChange: (key: string) => void;
  onUrlChange: (url: string) => void;
  paramRows: QueryParamRow[];
}

const withCount = (label: string, count: number) => (count > 0 ? `${label} (${count})` : label);

const RequestBuilder = memo<RequestBuilderProps>(
  ({
    activeTab,
    draft,
    loading,
    onCancel,
    onCopyCurl,
    onDraftChange,
    onOpenHistory,
    onOpenImport,
    onParamsChange,
    onSend,
    onTabChange,
    onUrlChange,
    paramRows,
  }) => {
    const { styles } = useStyles();
    const { t } = useTranslation('tools');

    const activeParamCount = paramRows.filter((row) => row.enabled && row.key.trim()).length;
    const activeHeaderCount = draft.headers.filter((row) => row.enabled && row.key.trim()).length;

    const tabs = [
      {
        children: (
          <KeyValueEditor
            addLabel={t('apitest.addParam')}
            keyPlaceholder={t('apitest.paramKey')}
            onChange={onParamsChange}
            onCreateRow={createParamRow}
            rows={paramRows}
            valuePlaceholder={t('apitest.paramValue')}
          />
        ),
        key: 'params',
        label: withCount(t('apitest.params'), activeParamCount),
      },
      {
        children: <AuthTab draft={draft} onChange={onDraftChange} />,
        key: 'auth',
        label: t('apitest.auth'),
      },
      {
        children: (
          <KeyValueEditor
            addLabel={t('apitest.addHeader')}
            keyOptions={COMMON_HEADER_NAMES}
            keyPlaceholder={t('apitest.headerKey')}
            onChange={(rows) => onDraftChange({ headers: rows })}
            onCreateRow={createHeaderRow}
            rows={draft.headers}
            valuePlaceholder={t('apitest.headerValue')}
          />
        ),
        key: 'headers',
        label: withCount(t('apitest.headers'), activeHeaderCount),
      },
      {
        children: (
          <BodyTab
            body={draft.body}
            contentType={draft.contentType}
            method={draft.method}
            onChange={onDraftChange}
          />
        ),
        key: 'body',
        label: t('apitest.body'),
      },
    ];

    return (
      <Flexbox className={styles.card} gap={12}>
        {/* Method + URL + Send/Cancel */}
        <Flexbox align={'center'} gap={8} horizontal>
          <Select
            className={styles.methodSelect}
            onChange={(value) => onDraftChange({ method: value })}
            options={HTTP_METHODS.map((m) => ({ label: m, value: m }))}
            value={draft.method}
          />
          <Input
            allowClear
            className={styles.urlInput}
            onChange={(e) => onUrlChange(e.target.value)}
            onPressEnter={onSend}
            placeholder={'https://api.example.com/v1/users'}
            value={draft.url}
          />
          {loading ? (
            <Button danger icon={<X size={14} />} onClick={onCancel}>
              {t('apitest.cancel')}
            </Button>
          ) : (
            <Tooltip title={t('apitest.sendShortcut')}>
              <Button icon={<Send size={14} />} onClick={onSend} type={'primary'}>
                {t('apitest.send')}
              </Button>
            </Tooltip>
          )}
        </Flexbox>

        {/* Toolbar: import / export / history */}
        <Flexbox align={'center'} gap={8} horizontal>
          <Button icon={<Import size={14} />} onClick={onOpenImport} size={'small'}>
            {t('apitest.importCurl')}
          </Button>
          <Button
            disabled={!draft.url.trim()}
            icon={<Terminal size={14} />}
            onClick={onCopyCurl}
            size={'small'}
          >
            {t('apitest.copyAsCurl')}
          </Button>
          <Button icon={<History size={14} />} onClick={onOpenHistory} size={'small'}>
            {t('apitest.history')}
          </Button>
        </Flexbox>

        <Divider style={{ margin: '4px 0' }} />

        {/* Params / Auth / Headers / Body tabs */}
        <Tabs
          activeKey={activeTab}
          items={tabs}
          onChange={onTabChange}
          size={'small'}
          tabBarStyle={{ marginBottom: 0 }}
        />
      </Flexbox>
    );
  },
);

RequestBuilder.displayName = 'RequestBuilder';

export default RequestBuilder;
