import isEqual from 'fast-deep-equal';
import { ReactNode, memo } from 'react';

import DevModal from '@/features/PluginDevModal';
import { useToolStore } from '@/store/tool';
import { pluginSelectors } from '@/store/tool/slices/plugin/selectors';

interface EditCustomPluginProps {
  children: ReactNode;
  identifier: string;
  onOpenChange: (open: boolean) => void;
  open: boolean;
}

const EditCustomPlugin = memo<EditCustomPluginProps>(
  ({ identifier, open, onOpenChange, children }) => {
    const [updateCustomPlugin, updateNewDevPlugin, uninstallCustomPlugin] = useToolStore((s) => [
      s.updateCustomPlugin,
      s.updateNewCustomPlugin,
      s.uninstallCustomPlugin,
    ]);

    const customPlugin = useToolStore(pluginSelectors.getCustomPluginById(identifier), isEqual);

    return (
      <div
        onClick={(e) => {
          e.stopPropagation();
        }}
      >
        <DevModal
          key={identifier}
          mode={'edit'}
          onDelete={() => {
            uninstallCustomPlugin(identifier);
            onOpenChange(false);
          }}
          onOpenChange={onOpenChange}
          onSave={async (devPlugin) => {
            await updateCustomPlugin(identifier, devPlugin);
            onOpenChange(false);
          }}
          onValueChange={updateNewDevPlugin}
          open={open}
          value={customPlugin}
        />
        {children}
      </div>
    );
  },
);

export default EditCustomPlugin;
