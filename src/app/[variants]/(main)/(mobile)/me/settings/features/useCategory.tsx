import { Bot, Brain, Info, MessageSquareText, Mic2, Settings2, Sparkles } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTranslation } from 'react-i18next';

import { CellProps } from '@/components/Cell';
import { isDeprecatedEdition } from '@/const/version';
import { SettingsTabs } from '@/store/global/initialState';
import { featureFlagsSelectors, useServerConfigStore } from '@/store/serverConfig';

export const useCategory = () => {
  const router = useRouter();
  const { t } = useTranslation('setting');
  const { enableSkills, showLLM } = useServerConfigStore(featureFlagsSelectors);

  const items: CellProps[] = [
    {
      icon: Settings2,
      key: SettingsTabs.Common,
      label: t('tab.common'),
    },
    {
      icon: MessageSquareText,
      key: SettingsTabs.ChatInstruction,
      label: t('tab.chat-instruction'),
    },
    {
      icon: Sparkles,
      key: SettingsTabs.SystemAgent,
      label: t('tab.system-agent'),
    },
    showLLM &&
      (isDeprecatedEdition
        ? {
            icon: Brain,
            key: SettingsTabs.LLM,
            label: t('tab.llm'),
          }
        : {
            icon: Brain,
            key: SettingsTabs.Provider,
            label: t('tab.provider'),
          }),
    { icon: Mic2, key: SettingsTabs.TTS, label: t('tab.tts') },
    {
      icon: Bot,
      key: SettingsTabs.Agent,
      label: t('tab.agent'),
    },
    enableSkills && {
      icon: Sparkles,
      key: SettingsTabs.Skills,
      label: t('tab.skills'),
    },
    {
      icon: Info,
      key: SettingsTabs.About,
      label: t('tab.about'),
    },
  ].filter(Boolean) as CellProps[];

  return items.map((item) => ({
    ...item,
    onClick: () => router.push(`/settings?active=${item.key}`),
  }));
};
