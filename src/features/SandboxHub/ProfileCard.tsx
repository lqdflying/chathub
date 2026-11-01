'use client';

import type { SandboxProfileItem, SandboxServerHealth } from '@lobechat/types';
import { Avatar } from '@lobehub/ui';
import { Switch, Tag } from 'antd';
import { createStyles } from 'antd-style';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Flexbox } from 'react-layout-kit';

import { egressSummaryKey, formatDuration } from './format';

const useStyles = createStyles(({ css, token }) => ({
  card: css`
    box-sizing: border-box;
    width: 100%;
    min-width: 0;
    padding: 16px;
    border: 1px solid ${token.colorBorderSecondary};
    border-radius: ${token.borderRadiusLG}px;
    background: ${token.colorBgContainer};
  `,
  description: css`
    min-width: 0;
    overflow-wrap: anywhere;
    color: ${token.colorTextSecondary};
    font-size: 13px;
    line-height: 1.6;
  `,
  header: css`
    display: flex;
    gap: 12px;
    align-items: flex-start;
    justify-content: space-between;
    min-width: 0;
  `,
  instruction: css`
    overflow: auto;

    max-height: 320px;
    margin: 0;
    padding: 12px;
    border-radius: ${token.borderRadius}px;

    font-family: ${token.fontFamilyCode};
    font-size: 12px;
    line-height: 1.6;
    overflow-wrap: anywhere;
    white-space: pre-wrap;

    background: ${token.colorFillQuaternary};
  `,
  link: css`
    cursor: pointer;

    padding: 0;
    border: 0;

    font-size: 12px;
    color: ${token.colorLink};

    background: transparent;
  `,
  meta: css`
    display: flex;
    flex-wrap: wrap;
    gap: 4px 12px;

    min-width: 0;

    font-size: 12px;
    color: ${token.colorTextDescription};
  `,
  name: css`
    min-width: 0;
    font-size: 15px;
    font-weight: 600;
    overflow-wrap: anywhere;
  `,
  tag: css`
    margin: 0;
  `,
}));

const HEALTH_COLOR: Record<SandboxServerHealth, string> = {
  misconfigured: 'error',
  ok: 'success',
  unauthorized: 'error',
  unreachable: 'warning',
};

interface ProfileCardProps {
  health?: SandboxServerHealth;
  onToggle: (enabled: boolean) => Promise<void>;
  profile: SandboxProfileItem;
}

const ProfileCard = memo<ProfileCardProps>(({ health, onToggle, profile }) => {
  const { styles } = useStyles();
  const { t } = useTranslation('sandboxHub');
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  const [showInstruction, setShowInstruction] = useState(false);

  const timeLabel = (ms: number) => {
    const parts = formatDuration(ms);
    if (!parts) return undefined;
    return [
      parts.hours ? t('profile.duration.hours', { count: parts.hours }) : '',
      parts.minutes ? t('profile.duration.minutes', { count: parts.minutes }) : '',
    ]
      .filter(Boolean)
      .join(' ');
  };
  const idle = timeLabel(profile.sessionIdleTimeoutMs);
  const maxLifetime = timeLabel(profile.sessionMaxLifetimeMs);
  const egressTargets =
    profile.egress.mode === 'allowlist' ? profile.egress.targets.join(', ') : undefined;

  const toggle = async (enabled: boolean) => {
    setPending(true);
    setFailed(false);
    try {
      await onToggle(enabled);
    } catch {
      setFailed(true);
    } finally {
      setPending(false);
    }
  };

  return (
    <Flexbox className={styles.card} gap={12}>
      <div className={styles.header}>
        <Flexbox align={'center'} gap={12} horizontal style={{ minWidth: 0 }}>
          {profile.avatar && <Avatar avatar={profile.avatar} size={36} style={{ flex: 'none' }} />}
          <Flexbox gap={4} style={{ minWidth: 0 }}>
            <div className={styles.name}>{profile.name}</div>
            <div className={styles.description}>{profile.description}</div>
          </Flexbox>
        </Flexbox>
        <Switch
          aria-label={t('profile.toggle', { name: profile.name })}
          checked={profile.enabled}
          disabled={!profile.available && !profile.enabled}
          loading={pending}
          onChange={(checked) => void toggle(checked)}
        />
      </div>

      <div className={styles.meta}>
        <span>{t('profile.resources', { cpu: profile.cpu, memory: profile.memory })}</span>
        <span>
          {t(egressSummaryKey(profile.egress), {
            count: profile.egress.mode === 'allowlist' ? profile.egress.targets.length : 0,
          })}
        </span>
        <span>
          {idle ? t('profile.idle', { time: idle }) : t('profile.idlePerCall')}
          {maxLifetime ? ` · ${t('profile.maxLifetime', { time: maxLifetime })}` : ''}
        </span>
        <span>
          {t('profile.server', { name: profile.serverName })}{' '}
          {health && (
            <Tag bordered={false} className={styles.tag} color={HEALTH_COLOR[health]}>
              {t(`health.${health}`)}
            </Tag>
          )}
        </span>
      </div>

      {egressTargets && (
        <div className={styles.meta}>{t('profile.egressTargets', { targets: egressTargets })}</div>
      )}

      {!profile.available && <div className={styles.description}>{t('profile.unavailable')}</div>}
      {failed && <div className={styles.description}>{t('profile.toggleFailed')}</div>}

      <div>
        <button
          className={styles.link}
          onClick={() => setShowInstruction((value) => !value)}
          type="button"
        >
          {showInstruction ? t('profile.hideInstruction') : t('profile.showInstruction')}
        </button>
      </div>
      {showInstruction && <pre className={styles.instruction}>{profile.instruction}</pre>}
    </Flexbox>
  );
});

ProfileCard.displayName = 'SandboxHubProfileCard';

export default ProfileCard;
