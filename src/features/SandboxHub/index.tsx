'use client';

import type { SandboxServerHealth } from '@lobechat/types';
import { createStyles } from 'antd-style';
import { memo, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Flexbox } from 'react-layout-kit';

import { sandboxHubService } from '@/services/sandboxHub';
import { useToolStore } from '@/store/tool';
import { useUserStore } from '@/store/user';

import JobList from './JobList';
import ProfileCard, { type InstructionAccess } from './ProfileCard';

const useStyles = createStyles(({ css, token }) => ({
  hint: css`
    min-width: 0;
    overflow-wrap: anywhere;
    color: ${token.colorTextSecondary};
    font-size: 13px;
    line-height: 1.6;
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

  return (
    <Flexbox gap={16} style={{ minWidth: 0 }} width={'100%'}>
      <Flexbox gap={6}>
        <h1 className={styles.title}>{t('title')}</h1>
        <div className={styles.hint}>{t('description')}</div>
      </Flexbox>

      {loading && <div className={styles.hint}>{t('loading')}</div>}
      {(loadFailed || accountFailed) && <div className={styles.hint}>{t('loadFailed')}</div>}
      {!loading && !loadFailed && !accountFailed && profiles.length === 0 && (
        <div className={styles.hint}>{t('empty')}</div>
      )}

      {profiles.map((profile) => (
        <ProfileCard
          access={access}
          health={health[profile.serverId]}
          key={profile.id}
          onResetInstruction={() => resetSandboxProfileInstruction(profile.id)}
          onSaveInstruction={(instruction) => setSandboxProfileInstruction(profile.id, instruction)}
          onToggle={(enabled) => setSandboxProfileEnabled(profile.id, enabled)}
          profile={profile}
        />
      ))}

      {scope && profiles.length > 0 && <JobList profiles={profiles} scope={scope} />}
    </Flexbox>
  );
});

SandboxHub.displayName = 'SandboxHub';

export default SandboxHub;
