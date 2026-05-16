'use client';

import { Block, Icon, Tag } from '@lobehub/ui';
import { Alert, Button, Empty, Spin } from 'antd';
import { createStyles } from 'antd-style';
import { ChevronDown, ChevronRight, RefreshCw } from 'lucide-react';
import { memo, useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Center, Flexbox } from 'react-layout-kit';

import { isDesktop } from '@/const/version';
import type { McpTool } from '@/libs/mcp';
import { desktopClient } from '@/libs/trpc/client/desktop';
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
    height: 100%;
    padding: 16px;
    overflow-y: auto;
  `,
}));

interface ToolCardProps {
  tool: McpTool;
}

const ToolCard = memo<ToolCardProps>(({ tool }) => {
  const { styles, theme } = useStyles();
  const [expanded, setExpanded] = useState(false);
  const { t } = useTranslation('setting');

  const properties = tool.inputSchema?.properties as Record<string, { description?: string; type?: string }> | undefined;
  const required = (tool.inputSchema?.required as string[] | undefined) ?? [];
  const entries = properties ? Object.entries(properties) : [];

  return (
    <Block gap={8} padding={16}>
      <div
        className={styles.apiHeader}
        onClick={() => setExpanded(!expanded)}
      >
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
            <span style={{ fontSize: 12, color: theme.colorTextQuaternary }}>
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
                <div className={styles.paramDesc}>
                  {param.description || '-'}
                </div>
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
    args?: string[];
    auth?: {
      accessToken?: string;
      clientId?: string;
      clientSecret?: string;
      refreshToken?: string;
      scope?: string;
      token?: string;
      type: 'none' | 'bearer' | 'oauth2';
    };
    command?: string;
    env?: Record<string, string>;
    headers?: Record<string, string>;
    type: 'http' | 'stdio';
    url?: string;
  };
}

const ToolsPanel = memo<ToolsPanelProps>(({ identifier, mcpConnection }) => {
  const { styles } = useStyles();
  const { t } = useTranslation('setting');
  const [tools, setTools] = useState<McpTool[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const fetchTools = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      let result: any;

      if (mcpConnection.type === 'http') {
        const params: any = {
          name: identifier,
          type: 'http',
          url: mcpConnection.url,
        };
        if (mcpConnection.auth?.type !== 'none') {
          params.auth = mcpConnection.auth;
        }
        if (mcpConnection.headers) {
          params.headers = mcpConnection.headers;
        }
        result = await toolsClient.mcp.listTools.query(params);
      } else if (isDesktop) {
        // stdio MCP — only supported on desktop
        result = await desktopClient.mcp.listTools.query({
          args: mcpConnection.args || [],
          command: mcpConnection.command || '',
          name: identifier,
          type: 'stdio' as const,
        });
      } else {
        // stdio not supported in web mode
        setError('Stdio MCP tools can only be discovered in the desktop app.');
        setLoading(false);
        return;
      }

      setTools(result as unknown as McpTool[]);
    } catch (err) {
      setError((err as Error).message || t('mcpManagement.tools.error'));
    } finally {
      setLoading(false);
    }
  }, [identifier, mcpConnection, t]);

  useEffect(() => {
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
            <Button icon={<Icon icon={RefreshCw} />} onClick={fetchTools} size="small" type="primary">
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
        <Empty
          description={t('mcpManagement.tools.empty')}
          image={Empty.PRESENTED_IMAGE_SIMPLE}
        />
      </Center>
    );
  }

  // Tools list
  return (
    <Flexbox className={styles.wrapper} height={'100%'} style={{ overflowY: 'auto' }}>
      <Flexbox
        style={{ fontSize: 14, fontWeight: 500, marginBottom: 12 }}
      >
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
