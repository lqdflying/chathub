import { Button } from '@lobehub/ui';
import { PackagePlus } from 'lucide-react';
import { forwardRef, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import DevModal from '@/features/PluginDevModal';
import { useAgentStore } from '@/store/agent';
import { useToolStore } from '@/store/tool';

const MCP_OAUTH_OPEN_DEV_MODAL = 'mcpOAuthOpenDevModal';

const AddPluginButton = forwardRef<HTMLButtonElement>((props, ref) => {
  const { t } = useTranslation('setting');
  const [showModal, setModal] = useState(false);

  const [installCustomPlugin, updateNewDevPlugin] = useToolStore((s) => [
    s.installCustomPlugin,
    s.updateNewCustomPlugin,
  ]);
  const togglePlugin = useAgentStore((s) => s.togglePlugin);

  // Auto-open DevModal when resuming after MCP OAuth callback
  useEffect(() => {
    if (sessionStorage.getItem(MCP_OAUTH_OPEN_DEV_MODAL) === 'true') {
      sessionStorage.removeItem(MCP_OAUTH_OPEN_DEV_MODAL);
      // Small delay ensures the PluginStore modal has mounted first
      setTimeout(() => setModal(true), 100);
    }
  }, []);

  return (
    <div
      onClick={(e) => {
        e.stopPropagation();
      }}
    >
      <DevModal
        onOpenChange={setModal}
        onSave={async (devPlugin) => {
          await installCustomPlugin(devPlugin);
          await togglePlugin(devPlugin.identifier);
        }}
        onValueChange={updateNewDevPlugin}
        open={showModal}
      />
      <Button
        icon={PackagePlus}
        onClick={() => {
          setModal(true);
        }}
        ref={ref}
      >
        {t('plugin.addMCPPlugin')}
      </Button>
    </div>
  );
});

export default AddPluginButton;
