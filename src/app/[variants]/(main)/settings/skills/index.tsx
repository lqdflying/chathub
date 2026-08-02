'use client';

import { Button, DraggablePanel, Empty, Input } from '@lobehub/ui';
import { App, Form, Modal, Tag } from 'antd';
import { createStyles, useTheme } from 'antd-style';
import { Download, Search, Trash2 } from 'lucide-react';
import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Center, Flexbox } from 'react-layout-kit';

import { skillService } from '@/services/skill';
import { useSkillStore } from '@/store/skill';

const useStyles = createStyles(({ css, token }) => ({
  detail: css`
    border-bottom: 1px solid ${token.colorBorderSecondary};
    padding: ${token.paddingMD}px;
  `,
}));

const SkillsManagement = memo(() => {
  const { t } = useTranslation('setting');
  const { message: messageApi, modal } = App.useApp();
  const theme = useTheme();
  const { styles } = useStyles();
  const detailRef = useRef<HTMLDivElement>(null);
  const skills = useSkillStore((s) => s.installedSkills);
  const installSkillFromUrl = useSkillStore((s) => s.installSkillFromUrl);
  const uninstall = useSkillStore((s) => s.uninstallSkill);
  const useFetchSkills = useSkillStore((s) => s.useFetchSkills);
  const [selectedId, setSelectedId] = useState<string>();
  const [search, setSearch] = useState('');
  const [source, setSource] = useState('');
  const [sourceModalOpen, setSourceModalOpen] = useState(false);
  const [registryItems, setRegistryItems] = useState<
    Awaited<ReturnType<typeof skillService.searchRegistry>>['items']
  >([]);
  const selected = skills.find(({ identifier }) => identifier === selectedId);

  useFetchSkills();

  useEffect(() => {
    let active = true;
    if (search.trim().length < 2) {
      setRegistryItems([]);
      return;
    }

    void skillService
      .searchRegistry(search)
      .then((result) => {
        if (active) setRegistryItems(result.items);
      })
      .catch((error) => {
        if (active) {
          setRegistryItems([]);
          messageApi.error(error instanceof Error ? error.message : String(error));
        }
      });

    return () => {
      active = false;
    };
  }, [messageApi, search]);

  const filtered = useMemo(
    () =>
      skills.filter(({ name, description, identifier }) =>
        `${name} ${description} ${identifier}`.toLowerCase().includes(search.toLowerCase()),
      ),
    [search, skills],
  );

  const installFromSource = async () => {
    if (!source.trim()) return;
    try {
      await installSkillFromUrl({
        sourceType: source.includes('github.com') ? 'github' : 'url',
        sourceUrl: source.trim(),
      });
      setSource('');
      setSourceModalOpen(false);
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : String(error));
    }
  };

  return (
    <Flexbox gap={12} height={'100%'} style={{ overflow: 'hidden' }} width={'100%'}>
      <Flexbox align={'center'} gap={8} horizontal justify={'space-between'}>
        <Input
          allowClear
          onChange={(event) => setSearch(event.target.value)}
          placeholder={t('skills.search')}
          prefix={<Search size={16} />}
          style={{ maxWidth: 420, width: '100%' }}
          value={search}
        />
        <Button icon={Download} onClick={() => setSourceModalOpen(true)} size="small">
          {t('skills.install')}
        </Button>
      </Flexbox>
      <Flexbox
        flex={1}
        horizontal
        style={{ borderTop: `1px solid ${theme.colorBorderSecondary}`, overflow: 'hidden' }}
      >
        <DraggablePanel maxWidth={540} minWidth={300} placement="left">
          <Flexbox gap={4} height="100%" padding={8} style={{ overflowY: 'auto' }}>
            {filtered.map((skill) => (
              <Button
                key={skill.identifier}
                onClick={() => {
                  setSelectedId(skill.identifier);
                  detailRef.current?.scrollTo({ top: 0 });
                }}
                style={{ justifyContent: 'flex-start', textAlign: 'left' }}
                type={selectedId === skill.identifier ? 'primary' : 'text'}
              >
                <Flexbox>
                  <span>{skill.name}</span>
                  <small>{skill.description}</small>
                </Flexbox>
              </Button>
            ))}
            {registryItems.length > 0 && (
              <Flexbox gap={4} paddingBlock={8}>
                <small>{t('skills.registry')}</small>
                {registryItems.map((item) => (
                  <Button
                    key={item.identifier}
                    onClick={async () => {
                      try {
                        await installSkillFromUrl({
                          expectedIdentifier: item.identifier,
                          sourceRef: item.sourceRef,
                          sourceType: item.sourceType,
                          sourceUrl: item.sourceUrl,
                        });
                      } catch (error) {
                        messageApi.error(error instanceof Error ? error.message : String(error));
                      }
                    }}
                    style={{ justifyContent: 'flex-start', textAlign: 'left' }}
                    type="text"
                  >
                    <Flexbox>
                      <span>{item.name}</span>
                      <small>{item.description}</small>
                    </Flexbox>
                  </Button>
                ))}
              </Flexbox>
            )}
            {filtered.length === 0 && registryItems.length === 0 && (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} />
            )}
          </Flexbox>
        </DraggablePanel>
        <Flexbox
          flex={1}
          ref={detailRef}
          style={{ background: theme.colorBgContainerSecondary, overflow: 'auto' }}
        >
          {selected ? (
            <>
              <Flexbox align="center" className={styles.detail} gap={8} horizontal>
                <Flexbox flex={1}>
                  <strong>{selected.name}</strong>
                  <small>{selected.description}</small>
                </Flexbox>
                <Tag>{selected.sourceType}</Tag>
                <Button
                  danger
                  icon={Trash2}
                  onClick={() =>
                    modal.confirm({
                      centered: true,
                      onOk: async () => {
                        try {
                          await uninstall(selected.identifier);
                          setSelectedId(undefined);
                        } catch (error) {
                          messageApi.error(
                            error instanceof Error ? error.message : String(error),
                          );
                        }
                      },
                      title: t('skills.confirmUninstall'),
                    })
                  }
                  size="small"
                />
              </Flexbox>
              <Flexbox gap={12} padding={16}>
                <span>{selected.sourceUrl || t('skills.localSource')}</span>
                <code>{selected.contentHash}</code>
                <span>{t('skills.lazyLoading')}</span>
              </Flexbox>
            </>
          ) : (
            <Center height="100%">
              <Empty description={t('skills.emptySelect')} image={Empty.PRESENTED_IMAGE_SIMPLE} />
            </Center>
          )}
        </Flexbox>
      </Flexbox>
      <Modal
        centered
        footer={null}
        onCancel={() => setSourceModalOpen(false)}
        open={sourceModalOpen}
        title={t('skills.install')}
      >
        <Form layout="vertical">
          <Form.Item label={t('skills.source')}>
            <Input
              onChange={(event) => setSource(event.target.value)}
              placeholder="https://.../SKILL.md"
              value={source}
            />
          </Form.Item>
          <Button block disabled={!source.trim()} onClick={installFromSource} type="primary">
            {t('skills.install')}
          </Button>
        </Form>
      </Modal>
    </Flexbox>
  );
});

export default SkillsManagement;
