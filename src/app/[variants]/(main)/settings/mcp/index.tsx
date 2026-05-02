'use client';

import { Avatar, Button, Form, type FormGroupItemType, Tag } from '@lobehub/ui';
import { Empty, Typography } from 'antd';
import isEqual from 'fast-deep-equal';
import { LucideTrash2 } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { Center, Flexbox } from 'react-layout-kit';

import { FORM_STYLE } from '@/const/layoutTokens';
import { useFetchInstalledPlugins } from '@/hooks/useFetchInstalledPlugins';
import { useToolStore } from '@/store/tool';
import { pluginSelectors } from '@/store/tool/selectors';

const { Paragraph, Text } = Typography;

const McpManagement = memo(() => {
  const { t } = useTranslation('setting');

  const installedPlugins = useToolStore(pluginSelectors.installedPlugins, isEqual);
  const [uninstallMCPPlugin] = useToolStore((s) => [s.uninstallMCPPlugin]);

  useFetchInstalledPlugins();

  const mcpPlugins = installedPlugins.filter((p) => !!p.customParams?.mcp);

  const handleUninstall = async (identifier: string) => {
    await uninstallMCPPlugin(identifier);
  };

  const isEmpty = mcpPlugins.length === 0;

  const list: FormGroupItemType[] = mcpPlugins.map((plugin) => {
    const mcp = plugin.customParams!.mcp!;
    const manifest = plugin.manifest;
    const meta = manifest?.meta || {};
    const avatar = meta.avatar || plugin.identifier;

    const connectionLabel =
      mcp.type === 'http' ? (
        <Text code ellipsis style={{ maxWidth: 280 }}>
          {mcp.url}
        </Text>
      ) : (
        <Flexbox gap={4}>
          <Text code>
            {mcp.command}
            {mcp.args ? ` ${mcp.args.join(' ')}` : ''}
          </Text>
        </Flexbox>
      );

    return {
      avatar: <Avatar avatar={avatar} size={40} />,
      children: (
        <Flexbox align={'center'} gap={8} horizontal>
          <Tag color={mcp.type === 'http' ? 'blue' : 'green'}>
            {mcp.type?.toUpperCase()}
          </Tag>
          <Button
            icon={LucideTrash2}
            onClick={() => handleUninstall(plugin.identifier)}
            size={'small'}
            tooltip={t('mcpManagement.uninstall')}
            type={'text'}
          />
        </Flexbox>
      ),
      desc: (
        <Flexbox gap={4}>
          <Paragraph ellipsis={{ rows: 2 }} style={{ margin: 0 }} type={'secondary'}>
            {meta.description || plugin.identifier}
          </Paragraph>
          {connectionLabel}
        </Flexbox>
      ),
      label: (
        <Flexbox align={'center'} gap={8} horizontal>
          {meta.title || plugin.identifier}
          {plugin.runtimeType === 'mcp' && (
            <Tag color={'purple'}>{t('mcpManagement.mcpRuntime')}</Tag>
          )}
        </Flexbox>
      ),
      layout: 'horizontal' as const,
      minWidth: undefined,
    };
  });

  const emptyState = (
    <Center padding={40}>
      <Empty description={t('mcpManagement.empty')} image={Empty.PRESENTED_IMAGE_SIMPLE} />
    </Center>
  );

  return (
    <Form.Group
      style={{ maxWidth: '1024px', width: '100%' }}
      title={t('tab.mcp-management')}
      variant={'borderless'}
    >
      <Paragraph type="secondary">{t('mcpManagement.description')}</Paragraph>
      <Form items={isEmpty ? [] : list} itemsType={'group'} variant={'borderless'} {...FORM_STYLE} />
      {isEmpty && emptyState}
    </Form.Group>
  );
});

McpManagement.displayName = 'McpManagement';

export default McpManagement;
