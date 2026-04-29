import { Blocks } from 'lucide-react';
import { Suspense, memo, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import PluginStore from '@/features/PluginStore';
import { useModelSupportToolUse } from '@/hooks/useModelSupportToolUse';
import { useAgentStore } from '@/store/agent';
import { agentSelectors } from '@/store/agent/selectors';
import { featureFlagsSelectors, useServerConfigStore } from '@/store/serverConfig';
import { useToolStore } from '@/store/tool';

import Action from '../components/Action';
import { useControls } from './useControls';

const MCP_OAUTH_RESUME_EDIT = 'mcpOAuthResumeEdit';

const Tools = memo(() => {
  const { t } = useTranslation('setting');
  const [modalOpen, setModalOpen] = useState(false);
  const [updating, setUpdating] = useState(false);
  const items = useControls({ setModalOpen, setUpdating });
  const { enablePlugins } = useServerConfigStore(featureFlagsSelectors);

  const model = useAgentStore(agentSelectors.currentAgentModel);
  const provider = useAgentStore(agentSelectors.currentAgentModelProvider);

  const enableFC = useModelSupportToolUse(model, provider);

  // Resume MCP plugin editing after OAuth callback
  useEffect(() => {
    const resumeData = sessionStorage.getItem(MCP_OAUTH_RESUME_EDIT);
    if (resumeData) {
      try {
        const { formValues } = JSON.parse(resumeData);
        const updateNewCustomPlugin = useToolStore.getState().updateNewCustomPlugin;
        updateNewCustomPlugin(formValues);
        setModalOpen(true);
      } finally {
        sessionStorage.removeItem(MCP_OAUTH_RESUME_EDIT);
      }
    }
  }, []);

  if (!enablePlugins) return null;
  if (!enableFC)
    return <Action disabled icon={Blocks} showTooltip={true} title={t('tools.disabled')} />;

  return (
    <Suspense fallback={<Action disabled icon={Blocks} title={t('tools.title')} />}>
      <Action
        dropdown={{
          maxHeight: 500,
          maxWidth: 480,
          menu: { items },
          minWidth: 320,
        }}
        icon={Blocks}
        loading={updating}
        showTooltip={false}
        title={t('tools.title')}
      />
      <PluginStore open={modalOpen} setOpen={setModalOpen} />
    </Suspense>
  );
});

export default Tools;

export default Tools;
