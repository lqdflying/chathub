'use client';

import { MESSAGE_CANCEL_FLAT } from '@lobechat/const';
import {
  Button,
  Form,
  type FormGroupItemType,
  Icon,
  ImageSelect,
  InputPassword,
  Select,
} from '@lobehub/ui';
import { EditableMessage } from '@lobehub/ui/chat';
import { Segmented, Skeleton } from 'antd';
import { createStyles } from 'antd-style';
import isEqual from 'fast-deep-equal';
import { Ban, Gauge, Loader2Icon, Monitor, Moon, PenLineIcon, Sun, Waves } from 'lucide-react';
import { memo, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Flexbox } from 'react-layout-kit';

import { FORM_STYLE } from '@/const/layoutTokens';
import { imageUrl } from '@/const/url';
import { localeOptions } from '@/locales/resources';
import { useGlobalStore } from '@/store/global';
import { systemStatusSelectors } from '@/store/global/selectors';
import { useServerConfigStore } from '@/store/serverConfig';
import { serverConfigSelectors } from '@/store/serverConfig/selectors';
import { useUserStore } from '@/store/user';
import { settingsSelectors } from '@/store/user/selectors';
import { LocaleMode } from '@/types/locale';

const isInstructionSaveAbort = (error: unknown) => {
  const seenCauses = new Set<unknown>();
  let currentCause = error;

  for (let depth = 0; currentCause && depth < 6 && !seenCauses.has(currentCause); depth += 1) {
    seenCauses.add(currentCause);

    if (currentCause === MESSAGE_CANCEL_FLAT) return true;

    if (currentCause instanceof Error) {
      const errorMessage = currentCause.message.toLowerCase();
      if (
        currentCause.name === 'AbortError' ||
        errorMessage === MESSAGE_CANCEL_FLAT ||
        errorMessage === 'cancelled' ||
        errorMessage.includes('operation was aborted') ||
        errorMessage.includes('request was aborted') ||
        errorMessage.includes('user aborted')
      ) {
        return true;
      }
    }

    currentCause =
      typeof currentCause === 'object'
        ? (currentCause as { cause?: unknown }).cause
        : undefined;
  }

  return false;
};

const useStyles = createStyles(({ css }) => ({
  instructionPreview: css`
    min-width: 0;
    max-height: 160px;
    overflow: auto;
  `,
  instructionPreviewWrapper: css`
    min-width: 0;
  `,
}));

const Common = memo(() => {
  const { t } = useTranslation('setting');
  const { styles } = useStyles();

  const showAccessCodeConfig = useServerConfigStore(serverConfigSelectors.enabledAccessCode);
  const general = useUserStore((s) => settingsSelectors.currentSettings(s).general, isEqual);
  const themeMode = useGlobalStore(systemStatusSelectors.themeMode);
  const language = useGlobalStore(systemStatusSelectors.language);
  const [setSettings, isUserStateInit] = useUserStore((s) => [
    s.setSettings,
    s.isUserStateInit,
  ]);
  const [setThemeMode, switchLocale, isStatusInit] = useGlobalStore((s) => [
    s.switchThemeMode,
    s.switchLocale,
    s.isStatusInit,
  ]);
  const [loading, setLoading] = useState(false);
  const [instructionEditorOpen, setInstructionEditorOpen] = useState(false);
  const [instructionEditing, setInstructionEditing] = useState(false);
  const [instructionSaving, setInstructionSaving] = useState(false);
  const instructionSaveOperation = useRef(0);
  const confirmedInstruction = useRef(general.generalInstruction ?? '');

  useEffect(() => {
    if (!instructionSaving) confirmedInstruction.current = general.generalInstruction ?? '';
  }, [general.generalInstruction, instructionSaving]);

  const handleLangChange = (value: LocaleMode) => {
    switchLocale(value);
  };

  const handleInstructionEditorOpenChange = (open: boolean) => {
    setInstructionEditorOpen(open);
    if (!open) setInstructionEditing(false);
  };

  const handleInstructionChange = async (generalInstruction: string) => {
    if (generalInstruction === (general.generalInstruction ?? '')) {
      setInstructionEditing(false);
      setInstructionEditorOpen(false);
      return;
    }

    const saveOperation = ++instructionSaveOperation.current;
    setInstructionSaving(true);
    const previousInstruction = confirmedInstruction.current;
    setInstructionEditing(false);
    setInstructionEditorOpen(false);

    try {
      await setSettings({ general: { generalInstruction } }, { skipRefresh: true });
      if (saveOperation === instructionSaveOperation.current) {
        confirmedInstruction.current = generalInstruction;
      }
    } catch (error) {
      const isCurrentSave = saveOperation === instructionSaveOperation.current;
      if (!isCurrentSave || isInstructionSaveAbort(error)) return;

      useUserStore.setState((state) => ({
        settings: {
          ...state.settings,
          general: {
            ...state.settings.general,
            generalInstruction: previousInstruction,
          },
        },
      }));
    } finally {
      if (saveOperation === instructionSaveOperation.current) setInstructionSaving(false);
    }
  };

  const handleInstructionEdit = () => {
    setInstructionEditing(true);
    setInstructionEditorOpen(true);
  };

  if (!(isStatusInit && isUserStateInit))
    return <Skeleton active paragraph={{ rows: 5 }} title={false} />;

  const theme: FormGroupItemType = {
    children: [
      {
        children: (
          <Flexbox align={'flex-start'} gap={12} horizontal width={'100%'}>
            <Flexbox className={styles.instructionPreviewWrapper} flex={1}>
              <EditableMessage
                classNames={{ markdown: styles.instructionPreview }}
                editing={instructionEditing}
                height={'auto'}
                markdownProps={{
                  enableLatex: false,
                  enableMermaid: false,
                  variant: 'chat',
                }}
                onChange={handleInstructionChange}
                onEditingChange={setInstructionEditing}
                onOpenChange={handleInstructionEditorOpenChange}
                openModal={instructionEditorOpen}
                placeholder={t('settingCommon.generalInstruction.placeholder')}
                text={{
                  cancel: t('cancel', { ns: 'common' }),
                  confirm: t('ok', { ns: 'common' }),
                  edit: t('edit', { ns: 'common' }),
                  title: t('settingCommon.generalInstruction.title'),
                }}
                value={general.generalInstruction ?? ''}
                variant={'borderless'}
              />
            </Flexbox>
            <Button
              icon={PenLineIcon}
              iconPosition={'end'}
              iconProps={{ size: 12 }}
              onClick={handleInstructionEdit}
              size={'small'}
              type={'primary'}
            >
              {t('edit', { ns: 'common' })}
            </Button>
          </Flexbox>
        ),
        desc: t('settingCommon.generalInstruction.desc'),
        label: t('settingCommon.generalInstruction.title'),
        minWidth: undefined,
      },
      {
        children: (
          <ImageSelect
            height={60}
            onChange={setThemeMode}
            options={[
              {
                icon: Sun,
                img: imageUrl('theme_light.webp'),
                label: t('settingCommon.themeMode.light'),
                value: 'light',
              },
              {
                icon: Moon,
                img: imageUrl('theme_dark.webp'),
                label: t('settingCommon.themeMode.dark'),
                value: 'dark',
              },
              {
                icon: Monitor,
                img: imageUrl('theme_auto.webp'),
                label: t('settingCommon.themeMode.auto'),
                value: 'auto',
              },
            ]}
            unoptimized={false}
            value={themeMode}
            width={100}
          />
        ),
        label: t('settingCommon.themeMode.title'),
        minWidth: undefined,
      },
      {
        children: (
          <Select
            defaultValue={language}
            onChange={handleLangChange}
            options={[{ label: t('settingCommon.lang.autoMode'), value: 'auto' }, ...localeOptions]}
          />
        ),
        label: t('settingCommon.lang.title'),
      },
      {
        children: (
          <Segmented
            options={[
              {
                icon: <Icon icon={Ban} size={16} />,
                label: t('settingAppearance.animationMode.disabled'),
                value: 'disabled',
              },
              {
                icon: <Icon icon={Gauge} size={16} />,
                label: t('settingAppearance.animationMode.agile'),
                value: 'agile',
              },
              {
                icon: <Icon icon={Waves} size={16} />,
                label: t('settingAppearance.animationMode.elegant'),
                value: 'elegant',
              },
            ]}
          />
        ),
        desc: t('settingAppearance.animationMode.desc'),
        label: t('settingAppearance.animationMode.title'),
        minWidth: undefined,
        name: 'animationMode',
      },

      {
        children: (
          <InputPassword
            autoComplete={'new-password'}
            placeholder={t('settingSystem.accessCode.placeholder')}
          />
        ),
        desc: t('settingSystem.accessCode.desc'),
        hidden: !showAccessCodeConfig,
        label: t('settingSystem.accessCode.title'),
        name: 'password',
      },
    ],
    extra: (instructionSaving || loading) && (
      <Icon icon={Loader2Icon} size={16} spin style={{ opacity: 0.5 }} />
    ),
    title: t('settingCommon.title'),
  };

  return (
    <Form
      initialValues={general}
      items={[theme]}
      itemsType={'group'}
      onValuesChange={async (v) => {
        setLoading(true);
        await setSettings({ general: v });
        setLoading(false);
      }}
      variant={'borderless'}
      {...FORM_STYLE}
    />
  );
});

export default Common;
