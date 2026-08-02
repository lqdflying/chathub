'use client';

import { Button, DraggablePanel, Empty, Input } from '@lobehub/ui';
import { App, Form, Modal, Segmented, Tag, Upload } from 'antd';
import { createStyles, useTheme } from 'antd-style';
import { Download, FileUp, Link2, Search, Trash2 } from 'lucide-react';
import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Center, Flexbox } from 'react-layout-kit';

import { skillService } from '@/services/skill';
import { parseSkillArchive } from '@/services/skill/archive';
import { useSkillStore } from '@/store/skill';

const useStyles = createStyles(({ css, token }) => ({
  detail: css`
    border-bottom: 1px solid ${token.colorBorderSecondary};
    padding: ${token.paddingMD}px;
  `,
}));

interface SkillsManagementProps {
  mobile?: boolean;
}

const SkillsManagement = memo<SkillsManagementProps>(({ mobile = false }) => {
  const { t } = useTranslation('setting');
  const { message: messageApi, modal } = App.useApp();
  const theme = useTheme();
  const { styles } = useStyles();
  const detailRef = useRef<HTMLDivElement>(null);
  const skills = useSkillStore((s) => s.installedSkills);
  const installSkill = useSkillStore((s) => s.installSkill);
  const installSkillFromUrl = useSkillStore((s) => s.installSkillFromUrl);
  const uninstall = useSkillStore((s) => s.uninstallSkill);
  const useFetchSkills = useSkillStore((s) => s.useFetchSkills);
  const [selectedId, setSelectedId] = useState<string>();
  const [search, setSearch] = useState('');
  const [source, setSource] = useState('');
  const [installMode, setInstallMode] = useState<'file' | 'url'>('file');
  const [installing, setInstalling] = useState(false);
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

    const timeout = setTimeout(() => {
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
    }, 300);

    return () => {
      active = false;
      clearTimeout(timeout);
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
    setInstalling(true);
    try {
      await installSkillFromUrl({
        sourceType: source.includes('github.com') ? 'github' : 'url',
        sourceUrl: source.trim(),
      });
      setSource('');
      setSourceModalOpen(false);
      messageApi.success(t('skills.installSuccess'));
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : String(error));
    } finally {
      setInstalling(false);
    }
  };

  const installFromFile = async (file: File) => {
    setInstalling(true);
    try {
      const archive = await parseSkillArchive(file);
      await installSkill({
        instructions: archive.instructions,
        sourceRef: file.name,
        sourceType: 'file',
      });
      setSelectedId(archive.identifier);
      setSourceModalOpen(false);
      if (archive.bundledResourceCount > 0) {
        messageApi.warning(
          t('skills.resourcesSkipped', {
            name: archive.identifier,
            skipped: archive.bundledResourceCount,
          }),
        );
      } else {
        messageApi.success(t('skills.installSuccess'));
      }
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : String(error));
    } finally {
      setInstalling(false);
    }

    return false;
  };

  const uninstallSelected = () => {
    if (!selected) return;
    modal.confirm({
      centered: true,
      onOk: async () => {
        try {
          await uninstall(selected.identifier);
          setSelectedId(undefined);
        } catch (error) {
          messageApi.error(error instanceof Error ? error.message : String(error));
        }
      },
      title: t('skills.confirmUninstall'),
    });
  };

  const skillList = (
    <Flexbox gap={4} height={mobile ? undefined : '100%'} padding={8} style={{ overflowY: 'auto' }}>
      {filtered.map((skill) => (
        <Button
          key={skill.identifier}
          onClick={() => {
            setSelectedId(skill.identifier);
            detailRef.current?.scrollTo({ top: 0 });
          }}
          style={{ height: 'auto', justifyContent: 'flex-start', textAlign: 'left', width: '100%' }}
          type={selectedId === skill.identifier ? 'primary' : 'text'}
        >
          <Flexbox
            paddingBlock={4}
            style={{ minWidth: 0, overflowWrap: 'anywhere' }}
            width={'100%'}
          >
            <strong>{skill.name}</strong>
            <small>{skill.description}</small>
          </Flexbox>
        </Button>
      ))}
      {registryItems.length > 0 && (
        <Flexbox gap={4} paddingBlock={8}>
          <small>{t('skills.registry')}</small>
          {registryItems.map((item) => (
            <Button
              disabled={installing}
              key={item.identifier}
              onClick={async () => {
                setInstalling(true);
                try {
                  await installSkillFromUrl({
                    expectedIdentifier: item.identifier,
                    sourceRef: item.sourceRef,
                    sourceType: item.sourceType,
                    sourceUrl: item.sourceUrl,
                  });
                  messageApi.success(t('skills.installSuccess'));
                } catch (error) {
                  messageApi.error(error instanceof Error ? error.message : String(error));
                } finally {
                  setInstalling(false);
                }
              }}
              style={{
                height: 'auto',
                justifyContent: 'flex-start',
                textAlign: 'left',
                width: '100%',
              }}
              type="text"
            >
              <Flexbox paddingBlock={4}>
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
  );

  const skillDetail = selected ? (
    <>
      <Flexbox
        align={mobile ? 'stretch' : 'center'}
        className={styles.detail}
        gap={8}
        horizontal={!mobile}
      >
        <Flexbox flex={1} style={{ minWidth: 0, overflowWrap: 'anywhere' }}>
          <strong>{selected.name}</strong>
          <small>{selected.description}</small>
        </Flexbox>
        <Flexbox align={'center'} horizontal justify={mobile ? 'space-between' : undefined}>
          <Tag>{t(`skills.sourceTypes.${selected.sourceType}`)}</Tag>
          <Button
            aria-label={t('skills.uninstall')}
            danger
            icon={Trash2}
            onClick={uninstallSelected}
            size={mobile ? 'middle' : 'small'}
            title={t('skills.uninstall')}
          />
        </Flexbox>
      </Flexbox>
      <Flexbox gap={12} padding={16}>
        <span style={{ overflowWrap: 'anywhere' }}>
          {selected.sourceType === 'file'
            ? selected.sourceRef || t('skills.localSource')
            : selected.sourceUrl || t('skills.localSource')}
        </span>
        <code style={{ overflowWrap: 'anywhere' }}>{selected.contentHash}</code>
        <span>{t('skills.lazyLoading')}</span>
      </Flexbox>
    </>
  ) : (
    <Center height="100%">
      <Empty description={t('skills.emptySelect')} image={Empty.PRESENTED_IMAGE_SIMPLE} />
    </Center>
  );

  return (
    <Flexbox
      gap={12}
      height={mobile ? undefined : '100%'}
      padding={mobile ? 12 : undefined}
      style={{ overflow: mobile ? undefined : 'hidden' }}
      width={'100%'}
    >
      <Flexbox
        align={mobile ? 'stretch' : 'center'}
        gap={8}
        horizontal={!mobile}
        justify={'space-between'}
      >
        <Input
          allowClear
          onChange={(event) => setSearch(event.target.value)}
          placeholder={t('skills.search')}
          prefix={<Search size={16} />}
          style={{ maxWidth: 420, width: '100%' }}
          value={search}
        />
        <Button
          block={mobile}
          icon={Download}
          onClick={() => {
            setInstallMode('file');
            setSourceModalOpen(true);
          }}
          size="small"
        >
          {t('skills.install')}
        </Button>
      </Flexbox>
      {mobile ? (
        <Flexbox style={{ borderTop: `1px solid ${theme.colorBorderSecondary}` }}>
          {skillList}
        </Flexbox>
      ) : (
        <Flexbox
          flex={1}
          horizontal
          style={{ borderTop: `1px solid ${theme.colorBorderSecondary}`, overflow: 'hidden' }}
        >
          <DraggablePanel maxWidth={540} minWidth={300} placement="left">
            {skillList}
          </DraggablePanel>
          <Flexbox
            flex={1}
            ref={detailRef}
            style={{ background: theme.colorBgContainerSecondary, overflow: 'auto' }}
          >
            {skillDetail}
          </Flexbox>
        </Flexbox>
      )}
      {mobile && (
        <Modal
          centered
          footer={null}
          onCancel={() => setSelectedId(undefined)}
          open={!!selected}
          title={t('skills.details')}
        >
          {skillDetail}
        </Modal>
      )}
      <Modal
        centered
        footer={null}
        onCancel={() => setSourceModalOpen(false)}
        open={sourceModalOpen}
        title={t('skills.install')}
      >
        <Flexbox gap={16}>
          <Segmented
            block
            onChange={(value) => setInstallMode(value as 'file' | 'url')}
            options={[
              { icon: <FileUp size={16} />, label: t('skills.installModes.file'), value: 'file' },
              { icon: <Link2 size={16} />, label: t('skills.installModes.url'), value: 'url' },
            ]}
            value={installMode}
          />
          {installMode === 'file' ? (
            <Upload.Dragger
              accept=".skill"
              beforeUpload={installFromFile}
              disabled={installing}
              maxCount={1}
              showUploadList={false}
            >
              <Center gap={8} paddingBlock={24}>
                <FileUp size={28} />
                <span>{t('skills.uploadSkill')}</span>
              </Center>
            </Upload.Dragger>
          ) : (
            <Form layout="vertical">
              <Form.Item label={t('skills.source')}>
                <Input
                  onChange={(event) => setSource(event.target.value)}
                  placeholder="https://.../SKILL.md"
                  value={source}
                />
              </Form.Item>
              <Button
                block
                disabled={!source.trim()}
                loading={installing}
                onClick={installFromSource}
                type="primary"
              >
                {t('skills.install')}
              </Button>
            </Form>
          )}
        </Flexbox>
      </Modal>
    </Flexbox>
  );
});

export default SkillsManagement;
