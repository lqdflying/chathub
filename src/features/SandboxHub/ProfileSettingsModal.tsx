'use client';

import { chainPickEmoji } from '@lobechat/prompts';
import type {
  SandboxHubProfileSettingsInput,
  SandboxHubProfileSettingsItem,
  SandboxHubSettings,
} from '@lobechat/types';
import { Alert, Modal } from '@lobehub/ui';
import { Input, Select, Switch } from 'antd';
import { createStyles } from 'antd-style';
import { type ReactNode, memo, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import AutoGenerateAvatar from '@/features/AgentSetting/AgentMeta/AutoGenerateAvatar';
import { chatService } from '@/services/chat';
import { useUserStore } from '@/store/user';
import { systemAgentSelectors } from '@/store/user/slices/settings/selectors';
import { merge } from '@/utils/merge';

import { formatDuration } from './format';
import {
  type FormError,
  type ProfileFormState,
  egressLabelKey,
  toFormState,
  toSettingsInput,
} from './settingsForm';

const useStyles = createStyles(({ css, responsive, token }) => ({
  avatarRow: css`
    display: flex;
    gap: 8px;
    align-items: center;

    ${responsive.mobile} {
      flex-direction: column;
      align-items: stretch;
    }
  `,
  error: css`
    font-size: 12px;
    line-height: 1.45;
    color: ${token.colorError};
  `,
  field: css`
    display: flex;
    flex-direction: column;
    gap: 4px;
    min-width: 0;
  `,
  form: css`
    display: flex;
    flex-direction: column;
    gap: 16px;
  `,
  hint: css`
    font-size: 12px;
    line-height: 1.45;
    color: ${token.colorTextDescription};
  `,
  label: css`
    font-size: 13px;
    font-weight: 500;
    line-height: 1.4;
  `,
  section: css`
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 12px 16px;

    ${responsive.mobile} {
      grid-template-columns: 1fr;
    }
  `,
  title: css`
    grid-column: 1 / -1;
    font-size: 12px;
    font-weight: 600;
    color: ${token.colorTextSecondary};
  `,
  url: css`
    flex: 1;
    min-width: 0;
  `,
  wide: css`
    grid-column: 1 / -1;
  `,
}));

interface ProfileSettingsModalProps {
  /** Undefined: add a profile. */
  item?: SandboxHubProfileSettingsItem;
  onClose: () => void;
  onSubmit: (id: string, input: SandboxHubProfileSettingsInput) => Promise<void>;
  open: boolean;
  settings: SandboxHubSettings;
}

/**
 * Add or edit one Sandbox Hub profile. Blank settings inherit the
 * OPENSANDBOX_* defaults, shown as placeholders. Short fields share a row
 * on a wide screen and stack on a phone.
 */
const ProfileSettingsModal = memo<ProfileSettingsModalProps>(
  ({ item, onClose, onSubmit, open, settings }) => {
    const { styles } = useStyles();
    const { t } = useTranslation('sandboxHub');
    const defaultServer =
      settings.servers.find((server) => server.status === 'ok')?.id ?? settings.servers[0]?.id;
    const [form, setForm] = useState<ProfileFormState>(() =>
      toFormState(item, defaultServer ?? ''),
    );
    const [fieldError, setFieldError] = useState<FormError['field']>();
    const [serverError, setServerError] = useState<string>();
    const [saving, setSaving] = useState(false);
    const [avatarLoading, setAvatarLoading] = useState(false);
    const [avatarError, setAvatarError] = useState<string>();
    /** Invalidates an avatar generate that finishes after the dialog is reopened. */
    const avatarRequest = useRef(0);

    useEffect(() => {
      if (!open) return;
      avatarRequest.current += 1;
      setAvatarLoading(false);
      setAvatarError(undefined);
      setForm(toFormState(item, defaultServer ?? ''));
      setFieldError(undefined);
      setServerError(undefined);
    }, [open, item, defaultServer]);

    const set = <K extends keyof ProfileFormState>(key: K, value: ProfileFormState[K]) =>
      setForm((current) => ({ ...current, [key]: value }));

    // Same cap as the profile schema: a 256px upload is usually under it.
    const setAvatar = (value: string) => {
      if (value.length > 64 * 1024) {
        setAvatarError(t('admin.form.avatarTooLarge'));
        return;
      }
      setAvatarError(undefined);
      set('avatar', value);
    };

    const generateAvatar = () => {
      const content = [form.name, form.description]
        .map((part) => part.trim())
        .filter(Boolean)
        .join(', ');
      if (!content) return;
      const request = ++avatarRequest.current;
      const current = () => avatarRequest.current === request;
      setAvatarError(undefined);
      void chatService.fetchPresetTaskResult({
        onError: () => {
          if (current()) setAvatarError(t('admin.form.avatarGenerateFailed'));
        },
        onFinish: async (emoji) => {
          if (current()) setAvatar(emoji.trim());
        },
        onLoadingChange: (loading) => {
          if (current()) setAvatarLoading(loading);
        },
        params: merge(
          systemAgentSelectors.agentMeta(useUserStore.getState()),
          chainPickEmoji(content),
        ),
      });
    };

    const durationLabel = (ms: number) => {
      const parts = formatDuration(ms);
      if (!parts) return t('admin.form.none');
      return [
        parts.hours ? t('profile.duration.hours', { count: parts.hours }) : '',
        parts.minutes ? t('profile.duration.minutes', { count: parts.minutes }) : '',
      ]
        .filter(Boolean)
        .join(' ');
    };
    const inherit = (value: string) => t('admin.form.inherit', { value });
    const { defaults } = settings;
    const invalid = (field: FormError['field']) =>
      fieldError === field ? t(`admin.form.invalid.${field}`) : undefined;

    const submit = async () => {
      const result = toSettingsInput(form);
      if (!result.ok) {
        setFieldError(result.error.field);
        return;
      }
      setFieldError(undefined);
      setServerError(undefined);
      setSaving(true);
      try {
        await onSubmit(item?.id ?? form.id.trim(), result.input);
        onClose();
      } catch (error) {
        setServerError(error instanceof Error ? error.message : String(error));
      } finally {
        setSaving(false);
      }
    };

    const text = (
      key: keyof ProfileFormState,
      label: string,
      placeholder?: string,
      inputMode?: 'decimal',
    ) => (
      <Input
        aria-label={label}
        inputMode={inputMode}
        onChange={(event) => set(key, event.target.value as never)}
        placeholder={placeholder}
        status={fieldError === key ? 'error' : undefined}
        value={form[key] as string}
      />
    );

    const field = (
      label: string,
      control: ReactNode,
      options?: { error?: string; hint?: string; wide?: boolean },
    ) => (
      <div className={options?.wide ? `${styles.field} ${styles.wide}` : styles.field}>
        <span className={styles.label}>{label}</span>
        {control}
        {options?.error ? (
          <span className={styles.error}>{options.error}</span>
        ) : (
          options?.hint && <span className={styles.hint}>{options.hint}</span>
        )}
      </div>
    );

    return (
      <Modal
        cancelText={t('admin.form.cancel')}
        centered
        confirmLoading={saving}
        destroyOnHidden
        okText={t('admin.form.save')}
        onCancel={onClose}
        onOk={() => void submit()}
        open={open}
        // With `centered`, only the form scrolls: 240px leaves room for the title, Save and margins.
        styles={{ body: { maxHeight: 'calc(100dvh - 240px)' } }}
        title={item ? t('admin.form.titleEdit', { name: item.name }) : t('admin.form.titleCreate')}
        width={720}
        // Above the default tooltip layer, so a leftover label cannot cover the sheet.
        zIndex={1100}
      >
        <div className={styles.form}>
          {item && <Alert message={t('admin.form.changeWarning')} showIcon type={'warning'} />}
          <section className={styles.section}>
            <div className={styles.title}>{t('admin.form.groups.basics')}</div>
            {!item &&
              field(t('admin.form.id'), text('id', t('admin.form.id'), 'data'), {
                hint: t('admin.form.idHint'),
                wide: true,
              })}
            {field(t('admin.form.name'), text('name', t('admin.form.name')), {
              error: invalid('name'),
            })}
            {field(t('admin.form.description'), text('description', t('admin.form.description')), {
              error: invalid('description'),
            })}
            {field(
              t('admin.form.avatar'),
              <div className={styles.avatarRow}>
                <AutoGenerateAvatar
                  canAutoGenerate={!!(form.name.trim() || form.description.trim())}
                  disabledTitle={t('admin.form.avatarGenerateNeedsText')}
                  loading={avatarLoading}
                  onChange={setAvatar}
                  onGenerate={generateAvatar}
                  value={form.avatar}
                />
                <Input
                  aria-label={t('admin.form.avatar')}
                  className={styles.url}
                  onChange={(event) => setAvatar(event.target.value)}
                  placeholder={
                    form.avatar.startsWith('data:')
                      ? t('admin.form.avatarUploaded')
                      : t('admin.form.avatarPlaceholder')
                  }
                  value={form.avatar.startsWith('data:') ? '' : form.avatar}
                />
              </div>,
              {
                error: avatarError,
                hint: t('admin.form.avatarHint'),
                wide: true,
              },
            )}
          </section>
          <section className={styles.section}>
            <div className={styles.title}>{t('admin.form.groups.resources')}</div>
            {field(
              t('admin.form.server'),
              <Select
                aria-label={t('admin.form.server')}
                onChange={(value: string) => set('serverId', value)}
                options={settings.servers.map((server) => ({
                  label:
                    server.status === 'ok'
                      ? server.name
                      : t('admin.form.serverMisconfigured', { name: server.name }),
                  value: server.id,
                }))}
                status={fieldError === 'serverId' ? 'error' : undefined}
                style={{ width: '100%' }}
                value={form.serverId || undefined}
              />,
              { error: invalid('serverId'), hint: t('admin.form.serverHint') },
            )}
            {field(
              t('admin.form.image'),
              text(
                'image',
                t('admin.form.image'),
                defaults.image ? inherit(defaults.image) : t('admin.form.imageRequired'),
              ),
              { hint: t('admin.form.imageHint') },
            )}
            {field(t('admin.form.cpu'), text('cpu', t('admin.form.cpu'), inherit(defaults.cpu)))}
            {field(
              t('admin.form.memory'),
              text('memory', t('admin.form.memory'), inherit(defaults.memory)),
            )}
          </section>
          <section className={styles.section}>
            <div className={styles.title}>{t('admin.form.groups.network')}</div>
            {field(
              t('admin.form.network'),
              <Select
                aria-label={t('admin.form.network')}
                onChange={(value: ProfileFormState['network']) => set('network', value)}
                options={(['inherit', 'open', 'none', 'allowlist'] as const).map((value) => ({
                  label:
                    value === 'inherit'
                      ? inherit(
                          t(egressLabelKey(defaults.egress), {
                            count:
                              defaults.egress.mode === 'allowlist'
                                ? defaults.egress.targets.length
                                : 0,
                          }),
                        )
                      : t(`admin.form.networkOption.${value}`),
                  value,
                }))}
                style={{ width: '100%' }}
                value={form.network}
              />,
            )}
            {field(
              t('admin.form.defaultEnabled'),
              <Switch
                aria-label={t('admin.form.defaultEnabled')}
                checked={form.defaultEnabled}
                onChange={(checked) => set('defaultEnabled', checked)}
                style={{ alignSelf: 'flex-start' }}
              />,
            )}
            {form.network === 'allowlist' &&
              field(
                t('admin.form.allowlist'),
                <Input.TextArea
                  aria-label={t('admin.form.allowlist')}
                  autoSize={{ maxRows: 6, minRows: 2 }}
                  onChange={(event) => set('allowlist', event.target.value)}
                  placeholder={'pypi.org\nfiles.pythonhosted.org'}
                  status={fieldError === 'allowlist' ? 'error' : undefined}
                  value={form.allowlist}
                />,
                { error: invalid('allowlist'), wide: true },
              )}
          </section>
          <section className={styles.section}>
            <div className={styles.title}>{t('admin.form.groups.lifetimes')}</div>
            {field(
              t('admin.form.idle'),
              text(
                'idleMinutes',
                t('admin.form.idle'),
                inherit(durationLabel(defaults.sessionIdleTimeoutMs)),
                'decimal',
              ),
              { error: invalid('idleMinutes'), hint: t('admin.form.idleHint') },
            )}
            {field(
              t('admin.form.maxLifetime'),
              text(
                'maxLifetimeMinutes',
                t('admin.form.maxLifetime'),
                inherit(durationLabel(defaults.sessionMaxLifetimeMs)),
                'decimal',
              ),
              { error: invalid('maxLifetimeMinutes'), hint: t('admin.form.minutesZeroNone') },
            )}
            {field(
              t('admin.form.ready'),
              text(
                'readySeconds',
                t('admin.form.ready'),
                inherit(String(Math.round(defaults.readyTimeoutMs / 1000))),
                'decimal',
              ),
              { error: invalid('readySeconds'), hint: t('admin.form.readyHint') },
            )}
            {field(
              t('admin.form.job'),
              text(
                'jobMinutes',
                t('admin.form.job'),
                inherit(durationLabel(defaults.jobMaxRuntimeMs)),
                'decimal',
              ),
              { error: invalid('jobMinutes'), hint: t('admin.form.jobHint') },
            )}
          </section>
          <section className={styles.section}>
            <div className={styles.title}>{t('admin.form.groups.behaviour')}</div>
            {field(
              t('admin.form.instructionBase'),
              <Select
                aria-label={t('admin.form.instructionBase')}
                onChange={(value: ProfileFormState['instructionBase']) =>
                  set('instructionBase', value)
                }
                options={(['general', 'none'] as const).map((value) => ({
                  label: t(`admin.form.instructionBaseOption.${value}`),
                  value,
                }))}
                style={{ width: '100%' }}
                value={form.instructionBase}
              />,
              { wide: true },
            )}
            {field(
              t('admin.form.instructionText'),
              <Input.TextArea
                aria-label={t('admin.form.instructionText')}
                autoSize={{ maxRows: 8, minRows: 2 }}
                onChange={(event) => set('instructionText', event.target.value)}
                value={form.instructionText}
              />,
              { hint: t('admin.form.instructionTextHint'), wide: true },
            )}
          </section>
          {serverError && <Alert message={serverError} showIcon type={'error'} />}
        </div>
      </Modal>
    );
  },
);

ProfileSettingsModal.displayName = 'SandboxHubProfileSettingsModal';

export default ProfileSettingsModal;
