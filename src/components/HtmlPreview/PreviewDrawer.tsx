import { exportFile } from '@lobechat/utils/client';
import { Block, Button, Highlighter, Segmented } from '@lobehub/ui';
import { Drawer } from 'antd';
import { createStyles } from 'antd-style';
import { Code2, Download, Eye } from 'lucide-react';
import { memo, useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Flexbox } from 'react-layout-kit';

import { useServerConfigStore } from '@/store/serverConfig';

const useStyles = createStyles(({ css }) => ({
  container: css`
    height: 100%;
  `,
  iframe: css`
    width: 100%;
    height: 100%;
    border: none;
  `,
}));

interface HtmlPreviewDrawerProps {
  content: string;
  onClose: () => void;
  open: boolean;
}

const HtmlPreviewDrawer = memo<HtmlPreviewDrawerProps>(({ content, open, onClose }) => {
  const { styles } = useStyles();
  const { t } = useTranslation('components');
  const mobile = useServerConfigStore((s) => s.isMobile);
  const [mode, setMode] = useState<'preview' | 'code'>('preview');

  const htmlContent = content;

  const extractTitle = useCallback(() => {
    const m = htmlContent.match(/<title>([\S\s]*?)<\/title>/i);
    return m ? m[1].trim() : undefined;
  }, [htmlContent]);

  const sanitizeFileName = useCallback((name: string) => {
    return name
      .replaceAll(/["*/:<>?\\|]/g, '-')
      .replaceAll(/\s+/g, ' ')
      .trim()
      .slice(0, 100);
  }, []);

  const onDownload = useCallback(() => {
    const title = extractTitle();
    const base = title ? sanitizeFileName(title) : `chat-html-preview-${Date.now()}`;
    exportFile(content, `${base}.html`);
  }, [content, extractTitle, sanitizeFileName]);

  const Title = (
    <Flexbox
      align={'center'}
      gap={8}
      horizontal
      justify={'space-between'}
      style={{ width: '100%' }}
    >
      {!mobile && t('HtmlPreview.title')}
      <Segmented
        onChange={(v) => setMode(v as 'preview' | 'code')}
        options={[
          {
            label: (
              <Flexbox align={'center'} gap={6} horizontal>
                <Eye size={16} />
                {t('HtmlPreview.mode.preview')}
              </Flexbox>
            ),
            value: 'preview',
          },
          {
            label: (
              <Flexbox align={'center'} gap={6} horizontal>
                <Code2 size={16} />
                {t('HtmlPreview.mode.code')}
              </Flexbox>
            ),
            value: 'code',
          },
        ]}
        value={mode}
      />
      <Button
        color={'default'}
        icon={<Download size={16} />}
        onClick={onDownload}
        variant={'filled'}
      >
        {!mobile && t('HtmlPreview.actions.download')}
      </Button>
    </Flexbox>
  );

  return (
    <Drawer
      destroyOnHidden
      // on mobile, shrink by the top safe-area so the header (close X) drops
      // below the status bar/notch instead of rendering behind it (matches the
      // @lobehub/ui Modal fullscreen idiom); env() is 0 on non-notch devices
      height={mobile ? 'calc(100dvh - env(safe-area-inset-top))' : '100dvh'}
      onClose={onClose}
      open={open}
      placement="bottom"
      styles={{
        body: { height: '100%', padding: 0 },
        header: { paddingBlock: 8, paddingInline: 12 },
      }}
      title={Title}
    >
      {mode === 'preview' ? (
        <Block className={styles.container}>
          <iframe
            className={styles.iframe}
            referrerPolicy={'no-referrer'}
            sandbox="allow-scripts"
            srcDoc={content}
            title={t('HtmlPreview.iframeTitle')}
          />
        </Block>
      ) : (
        <Block className={styles.container}>
          <Highlighter
            language={'html'}
            showLanguage={false}
            style={{ height: '100%', overflow: 'auto' }}
          >
            {htmlContent}
          </Highlighter>
        </Block>
      )}
    </Drawer>
  );
});

HtmlPreviewDrawer.displayName = 'HtmlPreviewDrawer';

export default HtmlPreviewDrawer;
