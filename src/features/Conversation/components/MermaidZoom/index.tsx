import { ActionIcon } from '@lobehub/ui';
import { createStyles } from 'antd-style';
import { Maximize2 } from 'lucide-react';
import React, { ComponentProps, ReactNode, memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useWorkspaceModal } from '@/hooks/useWorkspaceModal';

import MermaidDrawer from './MermaidDrawer';

const useStyles = createStyles(({ css }) => ({
  expand: css`
    position: absolute;
    z-index: 1;
    inset-block-start: 8px;
    inset-inline-end: 8px;

    opacity: 0;
    transition: opacity 0.2s;

    @media (hover: none) {
      opacity: 1;
    }
  `,
  trigger: css`
    position: relative;
    cursor: zoom-in;

    &:hover .expand-affordance {
      opacity: 1;
    }
  `,
}));

interface MermaidZoomProps {
  content: string;
  originalNode: ReactNode;
  theme?: ComponentProps<typeof MermaidDrawer>['theme'];
}

// bodyRender wrapper for @lobehub/ui's Mermaid: the inline diagram (antd pan-zoom
// lightbox disabled via enablePanZoom:false) opens in a bottom Drawer instead —
// same design as the HTML preview, so the ✕ stays below the notch and the phone
// Back closes it (via useWorkspaceModal) rather than getting stuck.
const MermaidZoom = memo<MermaidZoomProps>(({ content, originalNode, theme }) => {
  const { styles, cx } = useStyles();
  const { t } = useTranslation('components');
  const [open, setOpen] = useWorkspaceModal();

  return (
    <>
      <div
        className={styles.trigger}
        onClick={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            setOpen(true);
          }
        }}
        role={'button'}
        tabIndex={0}
      >
        {originalNode}
        <ActionIcon
          className={cx(styles.expand, 'expand-affordance')}
          icon={Maximize2}
          onClick={(e) => {
            e.stopPropagation();
            setOpen(true);
          }}
          size={'small'}
          title={t('Mermaid.actions.open')}
        />
      </div>
      <MermaidDrawer content={content} onClose={() => setOpen(false)} open={open} theme={theme} />
    </>
  );
});

MermaidZoom.displayName = 'MermaidZoom';

export default MermaidZoom;
