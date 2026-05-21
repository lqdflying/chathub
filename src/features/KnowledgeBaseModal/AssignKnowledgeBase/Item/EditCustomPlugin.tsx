import { ActionIcon } from '@lobehub/ui';
import isEqual from 'fast-deep-equal';
import { PackageSearch } from 'lucide-react';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import DevModal from '@/features/PluginDevModal';
import { useToolStore } from '@/store/tool';
import { pluginSelectors } from '@/store/tool/slices/plugin/selectors';

const EditCustomPlugin = memo<{ identifier: string }>(({ identifier }) => {
  const { t } = useTranslation('plugin');
  const [showModal, setModal] = useState(false);

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
        mode={'edit'}
        onDelete={() => {
          uninstallCustomPlugin(identifier);
          setModal(false);
        }}
        onOpenChange={setModal}
        onSave={async (devPlugin) => {
          await updateCustomPlugin(identifier, devPlugin);
          setModal(false);
        }}
        onValueChange={updateNewDevPlugin}
        open={showModal}
        value={customPlugin}
      />
      <ActionIcon
        icon={PackageSearch}
        onClick={() => {
          setModal(true);
        }}
        title={t('store.actions.manifest')}
      />
    </div>
  );
});

export default EditCustomPlugin;
