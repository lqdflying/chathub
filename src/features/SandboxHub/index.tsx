'use client';

import type {
  SandboxHubProfileSettingsInput,
  SandboxHubProfileSettingsItem,
  SandboxHubSettings,
  SandboxServerHealth,
} from '@lobechat/types';
import { Button } from 'antd';
import { createStyles } from 'antd-style';
import { memo, useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Flexbox } from 'react-layout-kit';

import { sandboxHubService } from '@/services/sandboxHub';
import { useToolStore } from '@/store/tool';
import { useUserStore } from '@/store/user';

import JobList from './JobList';
import ProfileAdminBar from './ProfileAdminBar';
import ProfileCard, { type InstructionAccess } from './ProfileCard';
import ProfileSettingsModal from './ProfileSettingsModal';

/** How often the page re-reads profile settings while an image is being prepared. */
const PREPARE_POLL_MS = 5000;

const useStyles = createStyles(({ css, token }) => ({
  card: css`
    box-sizing: border-box;
    width: 100%;
    min-width: 0;
    padding: 16px;
    border: 1px dashed ${token.colorWarningBorder};
    border-radius: ${token.borderRadiusLG}px;
  `,
  error: css`
    color: ${token.colorError};
    font-size: 13px;
    overflow-wrap: anywhere;
  `,
  hint: css`
    min-width: 0;
    overflow-wrap: anywhere;
    color: ${token.colorTextSecondary};
    font-size: 13px;
    line-height: 1.6;
  `,
  subtitle: css`
    margin: 0;
    font-size: 16px;
    font-weight: 600;
  `,
  title: css`
    margin: 0;
    font-size: 20px;
    font-weight: 600;
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

  const loading = !accountFailed && (!scope || (loadedScope !== scope && !loadFailed));
  const settingsOrder = hubSettings?.profiles ?? [];
  const offered = new Set(profiles.map((profile) => profile.id));
  const notOffered = settingsOrder.filter((item) => !offered.has(item.id));

  const adminBar = (item: SandboxHubProfileSettingsItem) => {
    const index = settingsOrder.findIndex((entry) => entry.id === item.id);
    return (
      <ProfileAdminBar
        busy={busy}
        first={index <= 0}
        item={item}
        last={index === settingsOrder.length - 1}
        onDelete={() => void adminChange((s) => sandboxHubService.deleteProfile(s, item.id))}
        onEdit={() => setEditor({ item, open: true })}
        onMove={(direction) =>
          void adminChange((s) => sandboxHubService.moveProfile(s, item.id, direction))
        }
        onPrepare={() => void adminChange((s) => sandboxHubService.prepareImage(s, item.id))}
      />
    );
  };

  return (
    <Flexbox gap={16} style={{ minWidth: 0 }} width={'100%'}>
      <Flexbox gap={6}>
        <Flexbox align={'center'} gap={12} horizontal justify={'space-between'}>
          <h1 className={styles.title}>{t('title')}</h1>
          {hubSettings && (
            <Button
              disabled={
                busy ||
                hubSettings.servers.length === 0 ||
                settingsOrder.length >= hubSettings.maxProfiles
              }
              onClick={() => setEditor({ open: true })}
              type={'primary'}
            >
              {t('admin.addProfile')}
            </Button>
          )}
        </Flexbox>
        <div className={styles.hint}>{t('description')}</div>
        {hubSettings && <div className={styles.hint}>{t('admin.hint')}</div>}
        {actionError && <div className={styles.error}>{actionError}</div>}
      </Flexbox>

      {loading && <div className={styles.hint}>{t('loading')}</div>}
      {(loadFailed || accountFailed) && <div className={styles.hint}>{t('loadFailed')}</div>}
      {!loading && !loadFailed && !accountFailed && profiles.length === 0 && (
        <div className={styles.hint}>{t('empty')}</div>
      )}

      {profiles.map((profile) => (
        <ProfileCard
          access={access}
          footer={(() => {
            const item = settingsOrder.find((entry) => entry.id === profile.id);
            return item ? adminBar(item) : undefined;
          })()}
          health={health[profile.serverId]}
          key={profile.id}
          onResetInstruction={() => resetSandboxProfileInstruction(profile.id)}
          onSaveInstruction={(instruction) => setSandboxProfileInstruction(profile.id, instruction)}
          onToggle={(enabled) => setSandboxProfileEnabled(profile.id, enabled)}
          profile={profile}
        />
      ))}

      {notOffered.length > 0 && (
        <Flexbox gap={8}>
          <h2 className={styles.subtitle}>{t('admin.notOffered')}</h2>
          <div className={styles.hint}>{t('admin.notOfferedHint')}</div>
          {notOffered.map((item) => (
            <Flexbox className={styles.card} gap={6} key={item.id}>
              <strong>{item.name}</strong>
              <div className={styles.hint}>{item.description}</div>
              {adminBar(item)}
            </Flexbox>
          ))}
        </Flexbox>
      )}

      {scope && profiles.length > 0 && <JobList profiles={profiles} scope={scope} />}

      {hubSettings && (
        <ProfileSettingsModal
          item={editor.item}
          onClose={() => setEditor({ open: false })}
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
