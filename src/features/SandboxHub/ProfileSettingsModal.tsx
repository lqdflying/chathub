'use client';

import { chainPickEmoji } from '@lobechat/prompts';
import type {
  SandboxHubProfileSettingsInput,
  SandboxHubProfileSettingsItem,
  SandboxHubSettings,
} from '@lobechat/types';
import { Alert, Form, type FormGroupItemType, type FormItemProps, Modal } from '@lobehub/ui';
import { Input, Select, Switch } from 'antd';
import { createStyles } from 'antd-style';
import { memo, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Flexbox } from 'react-layout-kit';

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

/** Tighter than the settings-page form this dialog reuses (48px groups, 16px rows). */
const useStyles = createStyles(({ css, prefixCls }) => ({
  form: css`
    && .${prefixCls}-form-item.${prefixCls}-form-item {
      padding-block: 8px;

      .${prefixCls}-row {
        gap: 8px;
      }
    }
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
 * Add or edit one Sandbox Hub profile, laid out as Settings groups. Blank
 * settings inherit the OPENSANDBOX_* defaults, shown as placeholders.
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

    /** One Settings row; a field error shows on its row. */
    const row = (
      field: FormError['field'] | undefined,
      label: string,
      children: FormItemProps['children'],
      desc?: string,
      extra: Partial<FormItemProps> = {},
    ): FormItemProps => ({
      children,
      desc,
      label,
      // Label above the field so the input uses the dialog width.
      layout: 'vertical',
      minWidth: undefined,
      ...(field && fieldError === field
        ? { help: t(`admin.form.invalid.${field}`), validateStatus: 'error' as const }
        : {}),
      ...extra,
    });

    const text = (key: keyof ProfileFormState, label: string, placeholder?: string) => (
      <Input
        aria-label={label}
        onChange={(event) => set(key, event.target.value as never)}
        placeholder={placeholder}
        value={form[key] as string}
      />
    );
    const minutes = (key: keyof ProfileFormState, label: string, placeholder: string) => (
      <Input
        aria-label={label}
        inputMode={'decimal'}
        onChange={(event) => set(key, event.target.value as never)}
        placeholder={placeholder}
        value={form[key] as string}
      />
    );

    const groups: FormGroupItemType[] = [
      {
        children: [
          ...(item
            ? []
            : [
                row(
                  undefined,
                  t('admin.form.id'),
                  text('id', t('admin.form.id'), 'data'),
                  t('admin.form.idHint'),
                ),
              ]),
          row('name', t('admin.form.name'), text('name', t('admin.form.name'))),
          row(
            'description',
            t('admin.form.description'),
            text('description', t('admin.form.description')),
          ),
          row(
            undefined,
            t('admin.form.avatar'),
            <Flexbox gap={8}>
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
                onChange={(event) => setAvatar(event.target.value)}
                placeholder={
                  form.avatar.startsWith('data:')
                    ? t('admin.form.avatarUploaded')
                    : t('admin.form.avatarPlaceholder')
                }
                value={form.avatar.startsWith('data:') ? '' : form.avatar}
              />
            </Flexbox>,
            t('admin.form.avatarHint'),
            { help: avatarError, validateStatus: avatarError ? 'error' : undefined },
          ),
          row(
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
              style={{ width: '100%' }}
              value={form.serverId || undefined}
            />,
            t('admin.form.serverHint'),
          ),
        ],
        key: 'basics',
        title: t('admin.form.groups.basics'),
      },
      {
        children: [
          row(
            undefined,
            t('admin.form.image'),
            text(
              'image',
              t('admin.form.image'),
              defaults.image ? inherit(defaults.image) : t('admin.form.imageRequired'),
            ),
            t('admin.form.imageHint'),
          ),
          {
            children: (
              <Flexbox gap={12} horizontal>
                <Flexbox flex={1} gap={4}>
                  <span>{t('admin.form.cpu')}</span>
                  {text('cpu', t('admin.form.cpu'), inherit(defaults.cpu))}
                </Flexbox>
                <Flexbox flex={1} gap={4}>
                  <span>{t('admin.form.memory')}</span>
                  {text('memory', t('admin.form.memory'), inherit(defaults.memory))}
                </Flexbox>
              </Flexbox>
            ),
            layout: 'vertical',
            minWidth: undefined,
          },
        ],
        key: 'resources',
        title: t('admin.form.groups.resources'),
      },
      {
        children: [
          row(
            undefined,
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
          ),
          row(
            'allowlist',
            t('admin.form.allowlist'),
            <Input.TextArea
              aria-label={t('admin.form.allowlist')}
              autoSize={{ maxRows: 8, minRows: 2 }}
              onChange={(event) => set('allowlist', event.target.value)}
              placeholder={'pypi.org\nfiles.pythonhosted.org'}
              value={form.allowlist}
            />,
            undefined,
            { hidden: form.network !== 'allowlist' },
          ),
        ],
        key: 'network',
        title: t('admin.form.groups.network'),
      },
      {
        children: [
          row(
            'idleMinutes',
            t('admin.form.idle'),
            minutes(
              'idleMinutes',
              t('admin.form.idle'),
              inherit(durationLabel(defaults.sessionIdleTimeoutMs)),
            ),
            t('admin.form.idleHint'),
          ),
          row(
            'maxLifetimeMinutes',
            t('admin.form.maxLifetime'),
            minutes(
              'maxLifetimeMinutes',
              t('admin.form.maxLifetime'),
              inherit(durationLabel(defaults.sessionMaxLifetimeMs)),
            ),
            t('admin.form.minutesZeroNone'),
          ),
          row(
            'readySeconds',
            t('admin.form.ready'),
            minutes(
              'readySeconds',
              t('admin.form.ready'),
              inherit(String(Math.round(defaults.readyTimeoutMs / 1000))),
            ),
            t('admin.form.readyHint'),
          ),
          row(
            'jobMinutes',
            t('admin.form.job'),
            minutes(
              'jobMinutes',
              t('admin.form.job'),
              inherit(durationLabel(defaults.jobMaxRuntimeMs)),
            ),
            t('admin.form.jobHint'),
          ),
        ],
        key: 'lifetimes',
        title: t('admin.form.groups.lifetimes'),
      },
      {
        children: [
          row(
            undefined,
            t('admin.form.defaultEnabled'),
            <Switch
              aria-label={t('admin.form.defaultEnabled')}
              checked={form.defaultEnabled}
              onChange={(checked) => set('defaultEnabled', checked)}
            />,
          ),
          row(
            undefined,
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
          ),
          row(
            undefined,
            t('admin.form.instructionText'),
            <Input.TextArea
              aria-label={t('admin.form.instructionText')}
              autoSize={{ maxRows: 12, minRows: 3 }}
              onChange={(event) => set('instructionText', event.target.value)}
              value={form.instructionText}
            />,
            t('admin.form.instructionTextHint'),
          ),
        ],
        key: 'behaviour',
        title: t('admin.form.groups.behaviour'),
      },
    ];

    return (
      <Modal
        cancelText={t('admin.form.cancel')}
        confirmLoading={saving}
        destroyOnHidden
        okText={t('admin.form.save')}
        onCancel={onClose}
        onOk={() => void submit()}
        open={open}
        title={item ? t('admin.form.titleEdit', { name: item.name }) : t('admin.form.titleCreate')}
        width={640}
        // Above the default tooltip layer, so a leftover label cannot cover the sheet.
        zIndex={1100}
      >
        <Flexbox gap={12}>
          {item && <Alert message={t('admin.form.changeWarning')} showIcon type={'warning'} />}
          <Form
            className={styles.form}
            gap={16}
            items={groups}
            itemsType={'group'}
            variant={'borderless'}
          />
          {serverError && <Alert message={serverError} showIcon type={'error'} />}
        </Flexbox>
      </Modal>
    );
  },
);

ProfileSettingsModal.displayName = 'SandboxHubProfileSettingsModal';

export default ProfileSettingsModal;
