import { ActionIcon } from '@lobehub/ui';
import { Eye } from 'lucide-react';
import React, { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useWorkspaceModal } from '@/hooks/useWorkspaceModal';

import HtmlPreviewDrawer from './PreviewDrawer';

interface HtmlPreviewActionProps {
  content: string;
  size?: number;
}

const HtmlPreviewAction = memo<HtmlPreviewActionProps>(({ content, size }) => {
  const { t } = useTranslation('components');
  // useWorkspaceModal drives the drawer's open state AND force-closes it on
  // mobile when `showMobileWorkspace` goes false. The phone Back pops exactly
  // the entry that set that query param, so Back both dismisses the drawer and
  // returns to the chat list — no custom history wiring needed. The safe-area
  // inset in PreviewDrawer keeps the ✕ reachable as the primary close.
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
