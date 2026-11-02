'use client';

import type {
  SandboxHubProfileSettingsInput,
  SandboxHubProfileSettingsItem,
  SandboxHubSettings,
} from '@lobechat/types';
import { Input, Modal, Select, Switch } from 'antd';
import { createStyles } from 'antd-style';
import { type ReactNode, memo, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Flexbox } from 'react-layout-kit';

import { formatDuration } from './format';
import {
  type FormError,
  type ProfileFormState,
  egressLabelKey,
  toFormState,
  toSettingsInput,
} from './settingsForm';

const useStyles = createStyles(({ css, token }) => ({
  error: css`
    color: ${token.colorError};
    font-size: 12px;
    overflow-wrap: anywhere;
  `,
  hint: css`
    color: ${token.colorTextDescription};
    font-size: 12px;
    overflow-wrap: anywhere;
  `,
  label: css`
    font-size: 13px;
    font-weight: 500;
  `,
  row: css`
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
    gap: 12px;
  `,
  warning: css`
    color: ${token.colorWarningText};
    font-size: 12px;
    line-height: 1.6;
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

/** Add or edit one Sandbox Hub profile. Blank settings inherit the OPENSANDBOX_* defaults. */
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

    useEffect(() => {
      if (!open) return;
      setForm(toFormState(item, defaultServer ?? ''));
      setFieldError(undefined);
      setServerError(undefined);
    }, [open, item, defaultServer]);

    const set = <K extends keyof ProfileFormState>(key: K, value: ProfileFormState[K]) =>
      setForm((current) => ({ ...current, [key]: value }));

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

    const field = (key: FormError['field'], label: string, control: ReactNode, hint?: string) => (
      <Flexbox gap={4}>
        <span className={styles.label}>{label}</span>
        {control}
        {hint && <span className={styles.hint}>{hint}</span>}
        {fieldError === key && (
          <span className={styles.error}>{t(`admin.form.invalid.${key}`)}</span>
        )}
      </Flexbox>
    );

    return (
      <Modal
        cancelText={t('admin.form.cancel')}
        confirmLoading={saving}
        destroyOnClose
        okText={t('admin.form.save')}
        onCancel={onClose}
        onOk={() => void submit()}
        open={open}
        title={item ? t('admin.form.titleEdit', { name: item.name }) : t('admin.form.titleCreate')}
        width={720}
      >
        <Flexbox gap={14}>
          {item ? (
            <div className={styles.warning}>{t('admin.form.changeWarning')}</div>
          ) : (
            <Flexbox gap={4}>
              <span className={styles.label}>{t('admin.form.id')}</span>
              <Input
                aria-label={t('admin.form.id')}
                onChange={(event) => set('id', event.target.value)}
                placeholder={'data'}
                value={form.id}
              />
              <span className={styles.hint}>{t('admin.form.idHint')}</span>
            </Flexbox>
          )}

          <div className={styles.row}>
            {field(
              'name',
              t('admin.form.name'),
              <Input
                aria-label={t('admin.form.name')}
                onChange={(event) => set('name', event.target.value)}
                value={form.name}
              />,
            )}
            {field(
              'serverId',
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
                value={form.serverId || undefined}
              />,
              t('admin.form.serverHint'),
            )}
          </div>

          {field(
            'description',
            t('admin.form.description'),
            <Input
              aria-label={t('admin.form.description')}
              onChange={(event) => set('description', event.target.value)}
              value={form.description}
            />,
          )}

          <Flexbox gap={4}>
            <span className={styles.label}>{t('admin.form.image')}</span>
            <Input
              aria-label={t('admin.form.image')}
              onChange={(event) => set('image', event.target.value)}
              placeholder={defaults.image ? inherit(defaults.image) : t('admin.form.imageRequired')}
              value={form.image}
            />
            <span className={styles.hint}>{t('admin.form.imageHint')}</span>
          </Flexbox>

          <div className={styles.row}>
            <Flexbox gap={4}>
              <span className={styles.label}>{t('admin.form.cpu')}</span>
              <Input
                aria-label={t('admin.form.cpu')}
                onChange={(event) => set('cpu', event.target.value)}
                placeholder={inherit(defaults.cpu)}
                value={form.cpu}
              />
            </Flexbox>
            <Flexbox gap={4}>
              <span className={styles.label}>{t('admin.form.memory')}</span>
              <Input
                aria-label={t('admin.form.memory')}
                onChange={(event) => set('memory', event.target.value)}
                placeholder={inherit(defaults.memory)}
                value={form.memory}
              />
            </Flexbox>
            <Flexbox gap={4}>
              <span className={styles.label}>{t('admin.form.avatar')}</span>
              <Input
                aria-label={t('admin.form.avatar')}
                onChange={(event) => set('avatar', event.target.value)}
                value={form.avatar}
              />
            </Flexbox>
          </div>

          {field(
            'allowlist',
            t('admin.form.network'),
            <Flexbox gap={6}>
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
                value={form.network}
              />
              {form.network === 'allowlist' && (
                <Input.TextArea
                  aria-label={t('admin.form.allowlist')}
                  autoSize={{ maxRows: 8, minRows: 2 }}
                  onChange={(event) => set('allowlist', event.target.value)}
                  placeholder={'pypi.org\nfiles.pythonhosted.org'}
                  value={form.allowlist}
                />
              )}
            </Flexbox>,
          )}

          <div className={styles.row}>
            {field(
              'idleMinutes',
              t('admin.form.idle'),
              <Input
                aria-label={t('admin.form.idle')}
                inputMode={'decimal'}
                onChange={(event) => set('idleMinutes', event.target.value)}
                placeholder={inherit(durationLabel(defaults.sessionIdleTimeoutMs))}
                value={form.idleMinutes}
              />,
              t('admin.form.idleHint'),
            )}
            {field(
              'maxLifetimeMinutes',
              t('admin.form.maxLifetime'),
              <Input
                aria-label={t('admin.form.maxLifetime')}
                inputMode={'decimal'}
                onChange={(event) => set('maxLifetimeMinutes', event.target.value)}
                placeholder={inherit(durationLabel(defaults.sessionMaxLifetimeMs))}
                value={form.maxLifetimeMinutes}
              />,
              t('admin.form.minutesZeroNone'),
            )}
            {field(
              'jobMinutes',
              t('admin.form.job'),
              <Input
                aria-label={t('admin.form.job')}
                inputMode={'decimal'}
                onChange={(event) => set('jobMinutes', event.target.value)}
                placeholder={inherit(durationLabel(defaults.jobMaxRuntimeMs))}
                value={form.jobMinutes}
              />,
              t('admin.form.jobHint'),
            )}
            {field(
              'readySeconds',
              t('admin.form.ready'),
              <Input
                aria-label={t('admin.form.ready')}
                inputMode={'decimal'}
                onChange={(event) => set('readySeconds', event.target.value)}
                placeholder={inherit(String(Math.round(defaults.readyTimeoutMs / 1000)))}
                value={form.readySeconds}
              />,
              t('admin.form.readyHint'),
            )}
          </div>

          <Flexbox align={'center'} gap={8} horizontal>
            <Switch
              aria-label={t('admin.form.defaultEnabled')}
              checked={form.defaultEnabled}
              onChange={(checked) => set('defaultEnabled', checked)}
            />
            <span className={styles.label}>{t('admin.form.defaultEnabled')}</span>
          </Flexbox>

          <Flexbox gap={4}>
            <span className={styles.label}>{t('admin.form.instructionBase')}</span>
            <Select
              aria-label={t('admin.form.instructionBase')}
              onChange={(value: ProfileFormState['instructionBase']) =>
                set('instructionBase', value)
              }
              options={(['general', 'none'] as const).map((value) => ({
                label: t(`admin.form.instructionBaseOption.${value}`),
                value,
              }))}
              value={form.instructionBase}
            />
            <Input.TextArea
              aria-label={t('admin.form.instructionText')}
              autoSize={{ maxRows: 12, minRows: 3 }}
              onChange={(event) => set('instructionText', event.target.value)}
              placeholder={t('admin.form.instructionTextHint')}
              value={form.instructionText}
            />
          </Flexbox>

          {serverError && <div className={styles.error}>{serverError}</div>}
        </Flexbox>
      </Modal>
    );
  },
);

ProfileSettingsModal.displayName = 'SandboxHubProfileSettingsModal';

export default ProfileSettingsModal;
