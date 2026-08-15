import { ActionIcon } from '@lobehub/ui';
import { Eye } from 'lucide-react';
import React, { memo, useEffect, useRef } from 'react';
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

  // useWorkspaceModal returns a fresh setter each render (use-merge-value), so
  // hold it in a ref — otherwise the history effect below would list it as a
  // dep and re-run on every parent rerender (e.g. streaming content updates),
  // churning the history stack and closing a drawer that should stay open.
  const setOpenRef = useRef(setOpen);
  setOpenRef.current = setOpen;

  // On mobile, tie the open drawer to a history entry so the phone Back closes
  // ONLY the drawer. Without it, Back pops the chat route and ejects the user
  // to the session list. The pushed entry keeps the same URL + Next router
  // state, so popstate never triggers a real navigation. Deps are [mobile,
  // open] only, so this runs once per open transition, not per render.
  const ownsEntryRef = useRef(false);
  useEffect(() => {
    if (!mobile || !open) return;
    window.history.pushState({ ...window.history.state, htmlPreview: true }, '');
    ownsEntryRef.current = true;
    const onPopState = () => {
      // Back consumed our entry — close the drawer, and don't pop again
      ownsEntryRef.current = false;
      setOpenRef.current(false);
    };
    window.addEventListener('popstate', onPopState);
    return () => {
      window.removeEventListener('popstate', onPopState);
      // closed via the ✕/programmatically (not Back): our entry is still on
      // top, so pop exactly it to keep the history stack clean
      if (ownsEntryRef.current) {
        ownsEntryRef.current = false;
        window.history.back();
      }
    };
  }, [mobile, open]);

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
