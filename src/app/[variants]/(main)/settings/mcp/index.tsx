'use client';

import { Button, DraggablePanel, Icon, Text } from '@lobehub/ui';
import { App, Empty, Input } from 'antd';
import { createStyles, useTheme } from 'antd-style';
import isEqual from 'fast-deep-equal';
import { Package, PackagePlus, Search, Store } from 'lucide-react';
import { memo, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Center, Flexbox } from 'react-layout-kit';

import PluginItem from '@/features/PluginStore/InstalledList/List/Item';
import PluginDevModal from '@/features/PluginDevModal';
import PluginStore from '@/features/PluginStore';
import { useFetchInstalledPlugins } from '@/hooks/useFetchInstalledPlugins';
import { useToolStore } from '@/store/tool';
import { pluginSelectors } from '@/store/tool/selectors';

const useStyles = createStyles(({ css, token }) => ({
  button: css`
    margin-block-start: ${token.marginLG}px;
  `,
  container: css`
    height: 80%;
    padding-block: ${token.paddingXL}px;
    padding-inline: ${token.paddingLG}px;
  `,
  description: css`
    max-width: 280px;
    line-height: 1.5;
    color: ${token.colorTextSecondary};
    text-align: center;
  `,
  iconWrapper: css`
    display: flex;
    align-items: center;
    justify-content: center;

    width: 64px;
    height: 64px;
    margin-block-end: ${token.marginMD}px;
    border-radius: 50%;

    background-color: ${token.colorPrimaryBg};
  `,
  title: css`
    margin-block-end: ${token.marginSM}px;

    font-size: ${token.fontSizeLG}px;
    font-weight: 500;
    color: ${token.colorText};
    text-align: center;
  `,
}));

const McpManagement = memo(() => {
  const { t } = useTranslation('setting');
  const { t: tPlugin } = useTranslation('plugin');
  const { modal } = App.useApp();
  const theme = useTheme();
  const { styles } = useStyles();
  const ref = useRef<HTMLDivElement>(null);

  const [showDevModal, setShowDevModal] = useState(false);
  const [showStore, setShowStore] = useState(false);
  const [selectedId, setSelectedId] = useState<string | undefined>();
  const [searchKeywords, setSearchKeywords] = useState('');

  const [installCustomPlugin, updateCustomPlugin, uninstallCustomPlugin, updateNewDevPlugin] =
    useToolStore((s) => [
      s.installCustomPlugin,
      s.updateCustomPlugin,
      s.uninstallCustomPlugin,
      s.updateNewCustomPlugin,
    ]);

  const installedPlugins = useToolStore(pluginSelectors.installedPlugins, isEqual);
  const installedMetaList = useToolStore(pluginSelectors.installedPluginMetaList, isEqual);

  useFetchInstalledPlugins();

  const mcpPlugins = installedPlugins.filter((p) => !!p.customParams?.mcp);

  const filteredList = useMemo(
    () =>
      installedMetaList.filter(
        (item) =>
          installedPlugins.some((p) => p.identifier === item.identifier && !!p.customParams?.mcp) &&
          [item?.title, item?.description, item.author, ...(item?.tags || [])]
            .filter(Boolean)
            .join('')
            .toLowerCase()
            .includes(searchKeywords.toLowerCase()),
      ),
    [installedMetaList, installedPlugins, searchKeywords],
  );

  const isEmpty = mcpPlugins.length === 0;

  const selectedPlugin = selectedId
    ? installedPlugins.find((p) => p.identifier === selectedId)
    : undefined;

  const handleAdd = () => {
    setSelectedId(undefined);
    setShowDevModal(true);
  };

  const handleUninstall = (identifier: string) => {
    modal.confirm({
      centered: true,
      okButtonProps: { danger: true },
      onOk: async () => {
        await uninstallCustomPlugin(identifier);
        if (selectedId === identifier) setSelectedId(undefined);
      },
      title: t('mcpManagement.confirmUninstall'),
      type: 'error',
    });
  };

  if (isEmpty) {
    return (
      <>
        <PluginDevModal
          mode="create"
          onOpenChange={setShowDevModal}
          onSave={async (devPlugin) => {
            await installCustomPlugin(devPlugin);
          }}
          onValueChange={updateNewDevPlugin}
          open={showDevModal}
        />
        <PluginStore open={showStore} setOpen={setShowStore} />
        <Center height={'75vh'} paddingBlock={40}>
          <Empty
            description={t('mcpManagement.empty')}
            image={Empty.PRESENTED_IMAGE_SIMPLE}
          >
            <Flexbox gap={8} horizontal justify={'center'}>
              <Button icon={PackagePlus} onClick={handleAdd}>
                {t('mcpManagement.add')}
              </Button>
              <Button icon={Store} onClick={() => setShowStore(true)}>
                {t('mcpManagement.store')}
              </Button>
            </Flexbox>
          </Empty>
        </Center>
      </>
    );
  }

  return (
    <>
      <PluginDevModal
        mode={selectedId ? 'edit' : 'create'}
        onDelete={
          selectedId
            ? () => {
                uninstallCustomPlugin(selectedId);
                setSelectedId(undefined);
                setShowDevModal(false);
              }
            : undefined
        }
        onOpenChange={setShowDevModal}
        onSave={async (devPlugin) => {
          if (selectedId) {
            await updateCustomPlugin(selectedId, devPlugin);
          } else {
            await installCustomPlugin(devPlugin);
          }
        }}
        onValueChange={updateNewDevPlugin}
        open={showDevModal}
        value={selectedPlugin as any}
      />
      <PluginStore open={showStore} setOpen={setShowStore} />

      <Flexbox gap={12} height={'100%'} style={{ overflow: 'hidden' }} width={'100%'}>
        <Flexbox align={'center'} gap={8} horizontal justify={'space-between'}>
          <Input
            allowClear
            onChange={(e) => setSearchKeywords(e.target.value)}
            placeholder={tPlugin('store.searchPlaceholder')}
            prefix={<Icon icon={Search} />}
            style={{ maxWidth: 400, width: '100%' }}
            value={searchKeywords}
          />
          <Flexbox gap={8} horizontal>
            <Button icon={PackagePlus} onClick={handleAdd} size={'small'}>
              {t('mcpManagement.add')}
            </Button>
            <Button icon={Store} onClick={() => setShowStore(true)} size={'small'}>
              {t('mcpManagement.store')}
            </Button>
          </Flexbox>
        </Flexbox>

        <Flexbox
          flex={1}
          horizontal
          style={{
            borderTop: `1px solid ${theme.colorBorderSecondary}`,
            overflow: 'hidden',
            position: 'relative',
          }}
        >
          <DraggablePanel maxWidth={540} minWidth={320} placement={'left'}>
            <Flexbox
              gap={2}
              height={'100%'}
              paddingBlock={4}
              paddingInline={4}
              style={{ overflowY: 'auto' }}
            >
              {filteredList.map((item) => {
                const plugin = installedPlugins.find((p) => p.identifier === item.identifier);
                const runtimeType = plugin?.runtimeType as
                  | 'mcp'
                  | 'default'
                  | 'markdown'
                  | 'standalone'
                  | undefined;

                return (
                  <PluginItem
                    active={selectedId === item.identifier}
                    key={item.identifier}
                    onClick={() => {
                      setSelectedId(item.identifier);
                      ref?.current?.scrollTo({ top: 0 });
                    }}
                    runtimeType={runtimeType}
                    type="plugin"
                    {...(item as any)}
                  />
                );
              })}
            </Flexbox>
          </DraggablePanel>

          {selectedId ? (
            <Flexbox
              height={'100%'}
              padding={16}
              ref={ref}
              style={{
                background: theme.colorBgContainerSecondary,
                overflowX: 'hidden',
                overflowY: 'auto',
              }}
              width={'100%'}
            >
              <Center className={styles.container}>
                <Flexbox align="center">
                  <div className={styles.iconWrapper}>
                    <Icon icon={Package} size={32} />
                  </div>
                  <Text className={styles.title}>
                    {selectedPlugin?.manifest?.meta?.title || selectedId}
                  </Text>
                  <Text className={styles.description}>
                    {t('mcpManagement.editPrompt')}
                  </Text>
                  <Button
                    className={styles.button}
                    onClick={() => {
                      setShowDevModal(true);
                    }}
                    type="primary"
                  >
                    {t('mcpManagement.editBtn')}
                  </Button>
                  <Button
                    className={styles.button}
                    onClick={() => handleUninstall(selectedId)}
                    type="default"
                  >
                    {t('mcpManagement.uninstall')}
                  </Button>
                </Flexbox>
              </Center>
            </Flexbox>
          ) : (
            <Center
              height={'100%'}
              style={{
                background: theme.colorBgContainerSecondary,
              }}
              width={'100%'}
            >
              <Empty
                description={tPlugin('store.emptySelectHint')}
                image={Empty.PRESENTED_IMAGE_SIMPLE}
              />
            </Center>
          )}
        </Flexbox>
      </Flexbox>
    </>
  );
});

McpManagement.displayName = 'McpManagement';

export default McpManagement;
