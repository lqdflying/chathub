import { ActionIcon, SyntaxMermaid } from '@lobehub/ui';
import { Drawer } from 'antd';
import { createStyles } from 'antd-style';
import { Minus, Plus, RotateCcw } from 'lucide-react';
import { ComponentProps, memo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Flexbox } from 'react-layout-kit';

import { useServerConfigStore } from '@/store/serverConfig';

type MermaidTheme = ComponentProps<typeof SyntaxMermaid>['theme'];

const MIN_SCALE = 0.5;
const MAX_SCALE = 3;
const STEP = 0.25;

const useStyles = createStyles(({ css, token }) => ({
  body: css`
    overflow: auto;
    height: 100%;
    padding: 16px;
  `,
  // The diagram fills the (scaled) wrapper; unlock SyntaxMermaid's intrinsic
  // caps (maxHeight 480 / minWidth 300 / object-fit) so our zoom controls the
  // real rendered size and the frame can scroll in both axes.
  diagram: css`
    & .${token.prefixCls}-image, & img {
      display: block;

      width: 100% !important;
      min-width: 0 !important;
      max-width: none !important;
      height: auto !important;
      max-height: none !important;
    }
  `,
}));

interface MermaidDrawerProps {
  content: string;
  onClose: () => void;
  open: boolean;
  theme?: MermaidTheme;
}

const MermaidDrawer = memo<MermaidDrawerProps>(({ content, open, onClose, theme }) => {
  const { styles } = useStyles();
  const { t } = useTranslation('components');
  const mobile = useServerConfigStore((s) => s.isMobile);
  const [scale, setScale] = useState(1);

  const Title = (
    <Flexbox
      align={'center'}
      gap={8}
      horizontal
      justify={'space-between'}
      style={{ width: '100%' }}
    >
      {!mobile && t('Mermaid.title')}
      <Flexbox align={'center'} gap={4} horizontal>
        <ActionIcon
          disabled={scale <= MIN_SCALE}
          icon={Minus}
          onClick={() => setScale((s) => Math.max(MIN_SCALE, s - STEP))}
          size={'small'}
          title={t('Mermaid.actions.zoomOut')}
        />
        <ActionIcon
          icon={RotateCcw}
          onClick={() => setScale(1)}
          size={'small'}
          title={t('Mermaid.actions.reset')}
        />
        <ActionIcon
          disabled={scale >= MAX_SCALE}
          icon={Plus}
          onClick={() => setScale((s) => Math.min(MAX_SCALE, s + STEP))}
          size={'small'}
          title={t('Mermaid.actions.zoomIn')}
        />
      </Flexbox>
    </Flexbox>
  );

  return (
    <Drawer
      destroyOnHidden
      // on mobile, shrink by the top safe-area so the header (close X) drops
      // below the status bar/notch instead of rendering behind it; env() is 0
      // on non-notch devices. Matches the HTML preview drawer.
      height={mobile ? 'calc(100dvh - env(safe-area-inset-top))' : '100dvh'}
      onClose={onClose}
      open={open}
      placement={'bottom'}
      styles={{
        body: { height: '100%', padding: 0 },
        header: { paddingBlock: 8, paddingInline: 12 },
      }}
      title={Title}
    >
      <div className={styles.body}>
        <div className={styles.diagram} style={{ width: `${scale * 100}%` }}>
          <SyntaxMermaid enablePanZoom={false} theme={theme} variant={'borderless'}>
            {content}
          </SyntaxMermaid>
        </div>
      </div>
    </Drawer>
  );
});

MermaidDrawer.displayName = 'MermaidDrawer';

export default MermaidDrawer;
