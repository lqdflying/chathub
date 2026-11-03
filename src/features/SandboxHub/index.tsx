'use client';

import type {
  SandboxEnvList,
  SandboxHubProfileSettingsInput,
  SandboxHubProfileSettingsItem,
  SandboxHubSettings,
  SandboxServerHealth,
} from '@lobechat/types';
import { Alert, Button, Icon, Tag } from '@lobehub/ui';
import { createStyles } from 'antd-style';
import { Plus, Server } from 'lucide-react';
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Flexbox } from 'react-layout-kit';

import { sandboxHubService } from '@/services/sandboxHub';
import { useToolStore } from '@/store/tool';
import { useUserStore } from '@/store/user';
import { DEFAULT_SANDBOX_PROFILE_ID } from '@/tools/sandbox/const';

import EnvModal, { type EnvSection } from './EnvModal';
import InstructionModal from './InstructionModal';
import JobList from './JobList';
import ProfileSection, {
  HEALTH_COLOR,
  type InstructionAccess,
  type ProfileAdminProps,
} from './ProfileSection';
import ProfileSettingsModal from './ProfileSettingsModal';

/** How often the page re-reads profile settings while an image is being prepared. */
const PREPARE_POLL_MS = 5000;

const useStyles = createStyles(({ css, token }) => ({
  // Same frame as a sandbox card.
  card: css`
    padding-block: 12px;
    padding-inline: 16px;
    border: 1px solid ${token.colorBorderSecondary};
    border-radius: ${token.borderRadiusLG}px;

    background: ${token.colorBgContainer};
  `,
  desc: css`
    margin: 0;
    line-height: 1.5;
    color: ${token.colorTextDescription};
    overflow-wrap: anywhere;
  `,
  hint: css`
    min-width: 0;
    color: ${token.colorTextDescription};
    font-size: 13px;
    line-height: 1.6;
    overflow-wrap: anywhere;
  `,
  serverIcon: css`
    flex: none;
    color: ${token.colorTextDescription};
  `,
  serverName: css`
    flex: 1;
    min-width: 0;
    font-weight: 500;
    overflow-wrap: anywhere;
  `,
  servers: css`
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
    gap: 12px;
  `,
  subtitle: css`
    margin: 0;
    font-size: 18px;
    font-weight: 600;
  `,
  // The Settings panel title (`PanelTitle`), without its sidebar padding.
  title: css`
    margin: 0;
    font-size: 26px;
    font-weight: 600;
    line-height: 1.3;
  `,
}));

const SandboxHub = memo(() => {
  const { styles } = useStyles();
  const { t } = useTranslation('sandboxHub');
  const scope = useUserStore((s) => (s.isUserStateInit ? s.userStateScope : undefined));
  const accountFailed = useUserStore(
    (s) => !s.isUserStateInit && !!s.userStateInitializationFailure,
  );
  const [
    profiles,
    loadedScope,
    loadSandboxProfiles,
    setSandboxProfileEnabled,
    setSandboxProfileInstruction,
    resetSandboxProfileInstruction,
  ] = useToolStore((s) => [
    s.sandboxProfiles,
    s.sandboxProfilesScope,
    s.loadSandboxProfiles,
    s.setSandboxProfileEnabled,
    s.setSandboxProfileInstruction,
    s.resetSandboxProfileInstruction,
  ]);
  const [health, setHealth] = useState<Record<string, SandboxServerHealth>>({});
  const [access, setAccess] = useState<InstructionAccess>();
  const [loadFailed, setLoadFailed] = useState(false);
  const [hubSettings, setHubSettings] = useState<SandboxHubSettings>();
  const [editor, setEditor] = useState<{ item?: SandboxHubProfileSettingsItem; open: boolean }>({
    open: false,
  });
  const [instructionDialog, setInstructionDialog] = useState<{ id?: string; open: boolean }>({
    open: false,
  });
  const [envList, setEnvList] = useState<SandboxEnvList>();
  const [envFailed, setEnvFailed] = useState(false);
  /** Bumped when a list or a save starts, so a late list cannot undo a save. */
  const envRequest = useRef(0);
  const [envDialog, setEnvDialog] = useState<{ id?: string; open: boolean }>({ open: false });
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string>();
  const canEdit = !!access?.canEdit;

  // Admins also see every profile's settings, including ones users are not offered.
  useEffect(() => {
    if (!scope || !canEdit) {
      setHubSettings(undefined);
      return;
    }
    let cancelled = false;
    sandboxHubService
      .profileSettings(scope)
      .then((next) => {
        if (!cancelled) setHubSettings(next);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [scope, canEdit]);

  const preparing = !!hubSettings?.profiles.some((item) => item.imageStatus === 'preparing');
  useEffect(() => {
    if (!scope || !preparing) return;
    const timer = setInterval(() => {
      sandboxHubService
        .profileSettings(scope)
        .then(setHubSettings)
        .catch(() => undefined);
    }, PREPARE_POLL_MS);
    return () => clearInterval(timer);
  }, [scope, preparing]);

  /** Runs an admin change, then refreshes the settings and everyone's profile list. */
  const adminChange = useCallback(
    async (change: (accountScope: string) => Promise<SandboxHubSettings>) => {
      if (!scope) return;
      setBusy(true);
      setActionError(undefined);
      try {
        setHubSettings(await change(scope));
        await loadSandboxProfiles(scope).catch(() => undefined);
      } catch (error) {
        setActionError(error instanceof Error ? error.message : String(error));
      } finally {
        setBusy(false);
      }
    },
    [scope, loadSandboxProfiles],
  );

  /** The modal reports a failed save itself, so this one rethrows. */
  const saveProfile = async (id: string, input: SandboxHubProfileSettingsInput) => {
    if (!scope) return;
    const next = editor.item
      ? await sandboxHubService.updateProfile(scope, id, input)
      : await sandboxHubService.createProfile(scope, id, input);
    setHubSettings(next);
    await loadSandboxProfiles(scope).catch(() => undefined);
  };

  useEffect(() => {
    if (!scope) return;
    setLoadFailed(false);
    loadSandboxProfiles(scope).catch(() => setLoadFailed(true));
    let cancelled = false;
    setAccess(undefined);
    sandboxHubService
      .serverStatus(scope)
      .then((next) => {
        if (!cancelled) setHealth(next);
      })
      .catch(() => undefined);
    setEnvList(undefined);
    setEnvFailed(false);
    const request = ++envRequest.current;
    sandboxHubService
      .listEnvs(scope)
      .then((next) => {
        if (!cancelled && envRequest.current === request) setEnvList(next);
      })
      .catch(() => {
        if (!cancelled && envRequest.current === request) setEnvFailed(true);
      });
    // Without an answer the instructions stay read-only.
    sandboxHubService
      .access(scope)
      .then((next) => {
        if (!cancelled) {
          setAccess({
            adminsConfigured: next.adminsConfigured,
            canEdit: next.canEditInstructions,
          });
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [scope, loadSandboxProfiles]);

  /** The dialog reports a failed change itself, so these rethrow. */
  const saveEnv = async (section: EnvSection, name: string, value: string, sensitive: boolean) => {
    if (!scope || !envDialog.id) return;
    const request = ++envRequest.current;
    const next =
      section === 'shared'
        ? await sandboxHubService.setSharedEnv(scope, envDialog.id, name, value, sensitive)
        : await sandboxHubService.setMyEnv(scope, envDialog.id, name, value, sensitive);
    if (envRequest.current !== request) return;
    setEnvList(next);
    setEnvFailed(false);
  };
  const deleteEnv = async (section: EnvSection, name: string) => {
    if (!scope || !envDialog.id) return;
    const request = ++envRequest.current;
    const next =
      section === 'shared'
        ? await sandboxHubService.deleteSharedEnv(scope, envDialog.id, name)
        : await sandboxHubService.deleteMyEnv(scope, envDialog.id, name);
    if (envRequest.current !== request) return;
    setEnvList(next);
    setEnvFailed(false);
  };

  const loading = !accountFailed && (!scope || (loadedScope !== scope && !loadFailed));
  const settingsOrder = hubSettings?.profiles ?? [];
  const offered = new Set(profiles.map((profile) => profile.id));
  const notOffered = settingsOrder.filter((item) => !offered.has(item.id));
  const instructionProfile = profiles.find((profile) => profile.id === instructionDialog.id);
  const envProfile = profiles.find((profile) => profile.id === envDialog.id);
  // Admins see every configured server; other users see the ones their sandboxes use.
  const servers = new Map<string, string>(
    hubSettings?.servers.map((server) => [server.id, server.name]),
  );
  for (const profile of profiles) {
    if (!servers.has(profile.serverId)) servers.set(profile.serverId, profile.serverName);
  }
  const envSummary = (profileId: string) => {
    if (!envList) return undefined;
    const entry = envList.profiles[profileId];
    return {
      available: envList.available,
      mine: entry?.mine.length ?? 0,
      shared: entry?.shared.length ?? 0,
    };
  };

  const adminProps = (profileId: string): ProfileAdminProps | undefined => {
    const index = settingsOrder.findIndex((entry) => entry.id === profileId);
    if (index < 0) return undefined;
    const item = settingsOrder[index];
    return {
      busy,
      first: index === 0,
      item,
      last: index === settingsOrder.length - 1,
      onDelete: () => adminChange((s) => sandboxHubService.deleteProfile(s, item.id)),
      onEdit: () => setEditor({ item, open: true }),
      onMove: (direction) =>
        void adminChange((s) => sandboxHubService.moveProfile(s, item.id, direction)),
      onPrepare: () => void adminChange((s) => sandboxHubService.prepareImage(s, item.id)),
    };
  };

  return (
    <Flexbox gap={24} style={{ minWidth: 0 }} width={'100%'}>
      <Flexbox gap={8}>
        <Flexbox align={'flex-start'} gap={16} horizontal justify={'space-between'}>
          <Flexbox gap={4} style={{ minWidth: 0 }}>
            <h1 className={styles.title}>{t('title')}</h1>
            <p className={styles.desc}>{t('description')}</p>
          </Flexbox>
          {hubSettings && (
            <Button
              disabled={
                busy ||
                hubSettings.servers.length === 0 ||
                settingsOrder.length >= hubSettings.maxProfiles
              }
              icon={Plus}
              onClick={() => setEditor({ open: true })}
              style={{ flex: 'none' }}
              type={'primary'}
            >
              {t('admin.addProfile')}
            </Button>
          )}
        </Flexbox>
        {hubSettings && <div className={styles.hint}>{t('admin.hint')}</div>}
        {actionError && (
          <Alert
            closable
            message={actionError}
            onClose={() => setActionError(undefined)}
            showIcon
            type={'error'}
          />
        )}
      </Flexbox>

      {servers.size > 0 && (
        <Flexbox gap={12}>
          <h2 className={styles.subtitle}>{t('servers')}</h2>
          <div className={styles.servers}>
            {[...servers].map(([id, name]) => (
              <Flexbox align={'center'} className={styles.card} gap={8} horizontal key={id}>
                <Icon className={styles.serverIcon} icon={Server} size={16} />
                <span className={styles.serverName}>{name}</span>
                {health[id] && (
                  <Tag color={HEALTH_COLOR[health[id]]} size={'small'}>
                    {t(`health.${health[id]}`)}
                  </Tag>
                )}
              </Flexbox>
            ))}
          </div>
        </Flexbox>
      )}

      <Flexbox gap={12}>
        <h2 className={styles.subtitle}>{t('sandboxes')}</h2>
        {loading && <div className={styles.hint}>{t('loading')}</div>}
        {(loadFailed || accountFailed) && <div className={styles.hint}>{t('loadFailed')}</div>}
        {!loading && !loadFailed && !accountFailed && profiles.length === 0 && (
          <div className={styles.hint}>{t('empty')}</div>
        )}
        {profiles.map((profile) => (
          <ProfileSection
            access={access}
            admin={adminProps(profile.id)}
            env={envSummary(profile.id)}
            health={health[profile.serverId]}
            key={profile.id}
            onOpenEnv={() => setEnvDialog({ id: profile.id, open: true })}
            onOpenInstruction={() => setInstructionDialog({ id: profile.id, open: true })}
            onToggle={(enabled) => setSandboxProfileEnabled(profile.id, enabled)}
            profile={profile}
          />
        ))}
      </Flexbox>

      {notOffered.length > 0 && (
        <Flexbox gap={12}>
          <Flexbox gap={4}>
            <h2 className={styles.subtitle}>{t('admin.notOffered')}</h2>
            <div className={styles.hint}>{t('admin.notOfferedHint')}</div>
          </Flexbox>
          {notOffered.map((item) => (
            <ProfileSection admin={adminProps(item.id)} key={item.id} />
          ))}
        </Flexbox>
      )}

      {scope && profiles.length > 0 && <JobList profiles={profiles} scope={scope} />}

      <InstructionModal
        access={access}
        onClose={() => setInstructionDialog((current) => ({ ...current, open: false }))}
        onReset={() => resetSandboxProfileInstruction(instructionDialog.id!)}
        onSave={(instruction) => setSandboxProfileInstruction(instructionDialog.id!, instruction)}
        open={instructionDialog.open && !!instructionProfile}
        profile={instructionProfile}
      />

      <EnvModal
        available={envList?.available ?? true}
        canEditShared={canEdit}
        entry={envDialog.id ? envList?.profiles[envDialog.id] : undefined}
        loadFailed={envFailed}
        onClose={() => setEnvDialog((current) => ({ ...current, open: false }))}
        onDelete={deleteEnv}
        onSave={saveEnv}
        open={envDialog.open && !!envProfile}
        profileName={envProfile?.name ?? ''}
      />

      {hubSettings && (
        <ProfileSettingsModal
          item={editor.item}
          onClose={() => setEditor({ open: false })}
          onOpenGeneralInstruction={
            profiles.some((profile) => profile.id === DEFAULT_SANDBOX_PROFILE_ID)
              ? () => setInstructionDialog({ id: DEFAULT_SANDBOX_PROFILE_ID, open: true })
              : undefined
          }
          onSubmit={saveProfile}
          open={editor.open}
          settings={hubSettings}
        />
      )}
    </Flexbox>
  );
});

SandboxHub.displayName = 'SandboxHub';

export default SandboxHub;
