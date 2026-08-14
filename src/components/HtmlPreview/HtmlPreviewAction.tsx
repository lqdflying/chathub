import { ActionIcon } from '@lobehub/ui';
import { Eye } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useWorkspaceModal } from '@/hooks/useWorkspaceModal';

import HtmlPreviewDrawer from './PreviewDrawer';

interface HtmlPreviewActionProps {
  content: string;
  size?: number;
}

const HtmlPreviewAction = memo<HtmlPreviewActionProps>(({ content, size }) => {
  const { t } = useTranslation('components');
  // useWorkspaceModal force-closes on mobile when the route/workspace changes,
  // so a phone Back dismisses the drawer instead of stranding it on top
  const [open, setOpen] = useWorkspaceModal();

  return (
    <>
      <ActionIcon
        icon={Eye}
        onClick={() => setOpen(true)}
        size={size}
        title={t('HtmlPreview.actions.preview')}
      />
      <HtmlPreviewDrawer content={content} onClose={() => setOpen(false)} open={open} />
    </>
  );
});

HtmlPreviewAction.displayName = 'HtmlPreviewAction';

export default HtmlPreviewAction;
