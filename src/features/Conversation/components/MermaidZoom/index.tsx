import { createStyles } from 'antd-style';
import { Maximize2 } from 'lucide-react';
import React, { ComponentProps, ReactNode, memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useWorkspaceModal } from '@/hooks/useWorkspaceModal';

import MermaidDrawer from './MermaidDrawer';

const useStyles = createStyles(({ css, token }) => ({
  // presentational only (aria-hidden, not focusable) — pointer activation
  // bubbles to the wrapper, so there is a single semantic open control
  expand: css`
    position: absolute;
    z-index: 1;
    inset-block-start: 8px;
    inset-inline-end: 8px;

    display: flex;
    align-items: center;
    justify-content: center;

    padding: 4px;
    border-radius: 6px;

    color: ${token.colorTextSecondary};

    opacity: 0;
    background: ${token.colorBgElevated};
    box-shadow: ${token.boxShadowTertiary};

    transition: opacity 0.2s;

    @media (hover: none) {
      opacity: 1;
    }
  `,
  trigger: css`
    cursor: zoom-in;
    position: relative;

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
// Back closes it (via useWorkspaceModal) rather than getting stuck. The whole
// diagram is the single focusable open control; the corner glyph is decorative.
const MermaidZoom = memo<MermaidZoomProps>(({ content, originalNode, theme }) => {
  const { styles, cx } = useStyles();
  const { t } = useTranslation('components');
  const [open, setOpen] = useWorkspaceModal();

  return (
    <>
      <div
        aria-label={t('Mermaid.actions.open')}
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
        <span aria-hidden className={cx(styles.expand, 'expand-affordance')}>
          <Maximize2 size={16} />
        </span>
      </div>
      <MermaidDrawer content={content} onClose={() => setOpen(false)} open={open} theme={theme} />
    </>
  );
});

MermaidZoom.displayName = 'MermaidZoom';

export default MermaidZoom;
