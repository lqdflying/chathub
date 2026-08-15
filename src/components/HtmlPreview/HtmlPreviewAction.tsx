import { ActionIcon } from '@lobehub/ui';
import { Eye } from 'lucide-react';
import { memo, useEffect } from 'react';
import { useTranslation } from 'react-i18next';

import { useWorkspaceModal } from '@/hooks/useWorkspaceModal';
import { useServerConfigStore } from '@/store/serverConfig';

import HtmlPreviewDrawer from './PreviewDrawer';

interface HtmlPreviewActionProps {
  content: string;
  size?: number;
}

const HtmlPreviewAction = memo<HtmlPreviewActionProps>(({ content, size }) => {
  const { t } = useTranslation('components');
  const mobile = useServerConfigStore((s) => s.isMobile);
  // useWorkspaceModal force-closes on mobile when the route/workspace changes
  const [open, setOpen] = useWorkspaceModal();

  // On mobile, tie the open drawer to a history entry so the phone Back closes
  // ONLY the drawer. Without it, Back pops the chat route and ejects the user
  // to the session list. The pushed entry keeps the same URL + Next router
  // state, so popstate never triggers a real navigation.
  useEffect(() => {
    if (!mobile || !open) return;
    window.history.pushState({ ...window.history.state, htmlPreview: true }, '');
    const onPopState = () => setOpen(false);
    window.addEventListener('popstate', onPopState);
    return () => {
      window.removeEventListener('popstate', onPopState);
      // closed via the ✕ (not Back): our entry is still on top — pop it so the
      // history stack doesn't keep a dangling drawer entry
      if (window.history.state?.htmlPreview) window.history.back();
    };
  }, [mobile, open, setOpen]);

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
