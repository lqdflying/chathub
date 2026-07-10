'use client';

import { App, Typography } from 'antd';
import { createStyles } from 'antd-style';
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Flexbox } from 'react-layout-kit';

import HistoryDrawer from './HistoryDrawer';
import ImportCurlModal from './ImportCurlModal';
import RequestBuilder from './RequestBuilder';
import ResponsePanel from './ResponsePanel';
import { REQUEST_TIMEOUT_MS } from './constants';
import { buildCurl } from './curl';
import { buildProxyRequestPayload, getResponseSize, isValidUrl } from './helpers';
import {
  type ApiTesterHistoryEntry,
  appendHistoryEntry,
  loadHistory,
  saveHistory,
} from './history';
import { buildUrlWithParams, parseQueryParams } from './queryParams';
import {
  type ApiTesterRequestDraft,
  type QueryParamRow,
  type ResponseState,
  createEmptyDraft,
  createRowId,
} from './types';

const useStyles = createStyles(({ css }) => ({
  title: css`
    margin-block-end: 0 !important;
  `,
}));

const ApitestWorkspace = memo(() => {
  const { styles } = useStyles();
  const { t } = useTranslation('tools');
  const { message } = App.useApp();

  // Request state
  const [draft, setDraft] = useState<ApiTesterRequestDraft>(() => createEmptyDraft());
  const [paramRows, setParamRows] = useState<QueryParamRow[]>([]);
  const [activeRequestTab, setActiveRequestTab] = useState('params');

  // Response state
  const [response, setResponse] = useState<ResponseState | null>(null);
  const [loading, setLoading] = useState(false);

  // History / modals
  const [history, setHistory] = useState<ApiTesterHistoryEntry[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);

  // In-flight request control
  const abortRef = useRef<AbortController | null>(null);
  const timedOutRef = useRef(false);

  // History lives in localStorage — load after mount to avoid hydration mismatch
  useEffect(() => {
    setHistory(loadHistory());
  }, []);

  const updateDraft = useCallback((patch: Partial<ApiTesterRequestDraft>) => {
    setDraft((prev) => ({ ...prev, ...patch }));
  }, []);

  // ── URL <-> query param rows sync (handler-driven) ─────────────────────────

  const handleUrlChange = useCallback((url: string) => {
    setDraft((prev) => ({ ...prev, url }));
    setParamRows(parseQueryParams(url));
  }, []);

  const handleParamsChange = useCallback((rows: QueryParamRow[]) => {
    setParamRows(rows);
    setDraft((prev) => ({ ...prev, url: buildUrlWithParams(prev.url, rows) }));
  }, []);

  // ── Send / cancel ───────────────────────────────────────────────────────────

  const handleSend = useCallback(async () => {
    if (loading) return;
    const url = draft.url.trim();
    if (!url) {
      message.error(t('apitest.emptyUrl'));
      return;
    }
    if (!isValidUrl(url)) {
      message.error(t('apitest.invalidUrl'));
      return;
    }

    setLoading(true);
    const start = Date.now();

    const controller = new AbortController();
    abortRef.current = controller;
    timedOutRef.current = false;
    const timeout = setTimeout(() => {
      timedOutRef.current = true;
      controller.abort();
    }, REQUEST_TIMEOUT_MS);

    let nextResponse: ResponseState;

    try {
      const res = await fetch('/webapi/tools/apitest', {
        body: JSON.stringify(buildProxyRequestPayload(draft)),
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
        signal: controller.signal,
      });

      const time = Date.now() - start;
      const payload = await res.json();

      if (!res.ok) {
        throw new Error(payload?.error || `API Tester proxy failed with status ${res.status}`);
      }

      const text = payload.body || '';

      const ct = payload.headers?.['content-type'] || payload.headers?.['Content-Type'] || '';
      let isJson = ct.includes('application/json');
      if (!isJson) {
        try {
          JSON.parse(text);
          isJson = true;
        } catch {
          // not JSON
        }
      }

      nextResponse = {
        body: text,
        headers: payload.headers || {},
        isJson,
        size: getResponseSize(text),
        status: payload.status,
        statusText: payload.statusText,
        time,
      };
    } catch (err) {
      const aborted = err instanceof DOMException && err.name === 'AbortError';
      const errorText = aborted
        ? timedOutRef.current
          ? t('apitest.timeoutError')
          : t('apitest.canceled')
        : err instanceof Error
          ? err.message
          : String(err);

      nextResponse = {
        body: '',
        error: errorText,
        headers: {},
        isJson: false,
        size: 0,
        status: 0,
        statusText: '',
        time: Date.now() - start,
      };
    } finally {
      clearTimeout(timeout);
      abortRef.current = null;
      setLoading(false);
    }

    setResponse(nextResponse);

    const entry: ApiTesterHistoryEntry = {
      createdAt: Date.now(),
      id: createRowId(),
      request: draft,
      response: nextResponse.error
        ? undefined
        : { size: nextResponse.size, status: nextResponse.status, time: nextResponse.time },
    };
    setHistory((prev) => {
      const next = appendHistoryEntry(prev, entry);
      saveHistory(next);
      return next;
    });
  }, [draft, loading, message, t]);

  const handleCancel = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  // Ctrl/Cmd + Enter sends from anywhere on the page
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
        event.preventDefault();
        handleSend();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [handleSend]);

  // ── History actions ─────────────────────────────────────────────────────────

  const applyDraft = useCallback((next: ApiTesterRequestDraft) => {
    // regenerate row ids so restored rows never collide with live ones
    setDraft({
      ...next,
      headers: next.headers.map((row) => ({ ...row, id: createRowId() })),
    });
    setParamRows(parseQueryParams(next.url));
  }, []);

  const handleRestore = useCallback(
    (entry: ApiTesterHistoryEntry) => {
      applyDraft(entry.request);
      setHistoryOpen(false);
    },
    [applyDraft],
  );

  const handleDeleteEntry = useCallback((id: string) => {
    setHistory((prev) => {
      const next = prev.filter((entry) => entry.id !== id);
      saveHistory(next);
      return next;
    });
  }, []);

  const handleClearHistory = useCallback(() => {
    setHistory([]);
    saveHistory([]);
  }, []);

  // ── cURL actions ────────────────────────────────────────────────────────────

  const handleCopyCurl = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(buildCurl(draft));
      message.success(t('apitest.copied'));
    } catch {
      message.error(t('apitest.copyFailed'));
    }
  }, [draft, message, t]);

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <Flexbox gap={20}>
      <Typography.Title className={styles.title} level={4}>
        {t('apitest.title')}
      </Typography.Title>

      <RequestBuilder
        activeTab={activeRequestTab}
        draft={draft}
        loading={loading}
        onCancel={handleCancel}
        onCopyCurl={handleCopyCurl}
        onDraftChange={updateDraft}
        onOpenHistory={() => setHistoryOpen(true)}
        onOpenImport={() => setImportOpen(true)}
        onParamsChange={handleParamsChange}
        onSend={handleSend}
        onTabChange={setActiveRequestTab}
        onUrlChange={handleUrlChange}
        paramRows={paramRows}
      />

      {response !== null && <ResponsePanel response={response} />}

      <HistoryDrawer
        entries={history}
        onClear={handleClearHistory}
        onClose={() => setHistoryOpen(false)}
        onDelete={handleDeleteEntry}
        onRestore={handleRestore}
        open={historyOpen}
      />

      <ImportCurlModal
        onClose={() => setImportOpen(false)}
        onImported={applyDraft}
        open={importOpen}
      />
    </Flexbox>
  );
});

ApitestWorkspace.displayName = 'ApitestWorkspace';

export default ApitestWorkspace;
