'use client';

import { Block, Icon, Tag } from '@lobehub/ui';
import { Alert, Button, Empty, Spin } from 'antd';
import { createStyles } from 'antd-style';
import { ChevronDown, ChevronRight, RefreshCw } from 'lucide-react';
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Center, Flexbox } from 'react-layout-kit';

import { toolsClient } from '@/libs/trpc/client/tools';

const useStyles = createStyles(({ css, token }) => ({
  apiDesc: css`
    overflow: hidden;
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;

    font-size: 12px;
    color: ${token.colorTextTertiary};
  `,
  apiHeader: css`
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: space-between;
  `,
  apiTitle: css`
    font-family: ${token.fontFamilyCode};
  `,
  paramDesc: css`
    font-size: 12px;
    line-height: 18px;
    color: ${token.colorTextSecondary};
  `,
  paramGrid: css`
    display: grid;
    grid-template-columns: 1fr 2fr;
    gap: 12px;
    align-items: center;

    margin-block-end: 8px;
  `,
  paramName: css`
    display: flex;
    gap: 6px;
    align-items: center;
    font-family: monospace;
  `,
  required: css`
    margin-inline-start: 2px;
    color: ${token.colorError};
  `,
  section: css`
    margin-block-start: ${token.marginSM}px;
  `,
  typeTag: css`
    height: 20px;
    padding-block: 0;
    padding-inline: 6px;

    font-size: 12px;
    line-height: 20px;
  `,
  wrapper: css`
    overflow-y: auto;
    height: 100%;
    padding: 16px;
  `,
}));

/** Shape returned by mcpService.listTools() via tRPC.
 *  The service maps MCP inputSchema → LobeChatPluginApi.parameters. */
interface DiscoveredTool {
  description?: string;
  name: string;
  parameters?: {
    properties?: Record<string, { description?: string; type?: string }>;
    required?: string[];
  };
}

const ToolCard = memo<{ tool: DiscoveredTool }>(({ tool }) => {
  const { styles, theme } = useStyles();
  const [expanded, setExpanded] = useState(false);
  const { t } = useTranslation('setting');

  const properties = tool.parameters?.properties;
  const required = tool.parameters?.required ?? [];
  const entries = properties ? Object.entries(properties) : [];

  return (
    <Block gap={8} padding={16}>
      <div className={styles.apiHeader} onClick={() => setExpanded(!expanded)}>
        <Flexbox gap={8}>
          <div className={styles.apiTitle}>{tool.name}</div>
          <div className={styles.apiDesc}>
            {tool.description || t('mcpManagement.tools.noDescription')}
          </div>
        </Flexbox>
        <Icon icon={expanded ? ChevronDown : ChevronRight} />
      </div>

      {expanded && (
        <Flexbox
          gap={12}
          padding={12}
          style={{ background: theme.colorFillQuaternary, borderRadius: 6 }}
        >
          <Flexbox gap={4}>
            <span style={{ color: theme.colorTextQuaternary, fontSize: 12 }}>
              {t('mcpManagement.tools.inputSchema')}
            </span>
          </Flexbox>
          {entries.map(([name, param]) => {
            const isRequired = required.includes(name);
            return (
              <div className={styles.paramGrid} key={name}>
                <div className={styles.paramName}>
                  <span>{name}</span>
                  {isRequired && <span className={styles.required}>*</span>}
                  {param.type && <Tag className={styles.typeTag}>{param.type}</Tag>}
                </div>
                <div className={styles.paramDesc}>{param.description || '-'}</div>
              </div>
            );
          })}
        </Flexbox>
      )}
    </Block>
  );
});

interface ToolsPanelProps {
  identifier: string;
  mcpConnection: {
    auth?: {
      accessToken?: string;
      clientId?: string;
      clientSecret?: string;
      refreshToken?: string;
      scope?: string;
      token?: string;
      type: 'none' | 'bearer' | 'oauth2';
    };
    headers?: Record<string, string>;
    type: string;
    url?: string;
  };
}

const ToolsPanel = memo<ToolsPanelProps>(({ identifier, mcpConnection }) => {
  const { styles } = useStyles();
  const { t } = useTranslation('setting');
  const [tools, setTools] = useState<DiscoveredTool[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const fetchIdRef = useRef(0);

  const fetchTools = useCallback(async () => {
    const fetchId = ++fetchIdRef.current;

    setLoading(true);
    setError(null);

    try {
      if (mcpConnection.type !== 'http' || !mcpConnection.url) {
        throw new Error('This MCP plugin uses an unsupported local transport.');
      }
      const params: any = {
        name: identifier,
        type: 'http' as const,
        url: mcpConnection.url,
      };
      if (mcpConnection.auth?.type !== 'none') params.auth = mcpConnection.auth;
      if (mcpConnection.headers) params.headers = mcpConnection.headers;
      const result = await toolsClient.mcp.listTools.query(params);

      // Guard against stale responses from rapid selection changes
      if (fetchId !== fetchIdRef.current) return;

      setTools(result as unknown as DiscoveredTool[]);
    } catch (err) {
      if (fetchId !== fetchIdRef.current) return;
      setError((err as Error).message || t('mcpManagement.tools.error'));
    } finally {
      if (fetchId === fetchIdRef.current) setLoading(false);
    }
  }, [identifier, mcpConnection, t]);

  useEffect(() => {
    // Reset state on identifier change so previous panel data doesn't flash
    setTools(null);
    setError(null);
    fetchTools();
  }, [fetchTools]);

  // Loading state
  if (loading) {
    return (
      <Center height={'100%'} width={'100%'}>
        <Spin tip={t('mcpManagement.tools.loading')} />
      </Center>
    );
  }

  // Error state
  if (error) {
    return (
      <Center height={'100%'} padding={16} width={'100%'}>
        <Alert
          action={
            <Button
              icon={<Icon icon={RefreshCw} />}
              onClick={fetchTools}
              size="small"
              type="primary"
            >
              {t('mcpManagement.tools.retry')}
            </Button>
          }
          message={error}
          showIcon
          type="error"
        />
      </Center>
    );
  }

  // Empty state
  if (!tools || tools.length === 0) {
    return (
      <Center height={'100%'} width={'100%'}>
        <Empty description={t('mcpManagement.tools.empty')} image={Empty.PRESENTED_IMAGE_SIMPLE} />
      </Center>
    );
  }

  // Tools list
  return (
    <Flexbox className={styles.wrapper} height={'100%'} style={{ overflowY: 'auto' }}>
      <Flexbox style={{ fontSize: 14, fontWeight: 500, marginBottom: 12 }}>
        {t('mcpManagement.tools.title')} ({tools.length})
      </Flexbox>
      <Flexbox direction="vertical" gap={4}>
        {tools.map((tool, index) => (
          <ToolCard key={`${tool.name}-${index}`} tool={tool} />
        ))}
      </Flexbox>
    </Flexbox>
  );
});

ToolsPanel.displayName = 'ToolsPanel';
ToolCard.displayName = 'ToolCard';

export default ToolsPanel;
