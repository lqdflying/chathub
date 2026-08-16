import { Highlighter, Icon } from '@lobehub/ui';
import { Spin } from 'antd';
import { createStyles } from 'antd-style';
import { Loader2 } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { Flexbox } from 'react-layout-kit';

import { useChatStore } from '@/store/chat';
import { chatToolSelectors } from '@/store/chat/selectors';
import { DallEImageItem } from '@/types/tool/dalle';

import Error from './Error';
import ImagePreview from './Image';

const useStyles = createStyles(({ css, token, prefixCls }) => ({
  container: css`
    overflow: scroll;
    aspect-ratio: 1;
    border: 1px solid ${token.colorBorder};
    border-radius: 8px;

    .${prefixCls}-spin-nested-loading {
      height: 100%;
    }
  `,
}));

const ImageItem = memo<DallEImageItem & { index: number; messageId: string }>(
  ({ prompt, messageId, imageId, previewUrl, index }) => {
    const { t } = useTranslation('tool');
    const { styles } = useStyles();

    // key loading by index so duplicate prompts don't share one spinner
    const loading = useChatStore(chatToolSelectors.isDallEImageGenerating(`${messageId}_${index}`));

    if (imageId || previewUrl)
      return <ImagePreview imageId={imageId} previewUrl={previewUrl} prompt={prompt} />;

    return (
      <Flexbox className={styles.container} padding={8}>
        {loading ? (
          <Spin indicator={<Icon icon={Loader2} spin />} size={'large'} tip={t('dalle.generating')}>
            {prompt}
          </Spin>
        ) : (
          <Flexbox gap={12}>
            <Flexbox>
              <Highlighter
                actionIconSize={'small'}
                fileName={t('dalle.prompt')}
                fullFeatured
                language={'prompt'}
                showLanguage
              >
                {prompt}
              </Highlighter>
            </Flexbox>
            <Error index={index} messageId={messageId} />
          </Flexbox>
        )}
      </Flexbox>
    );
  },
);

export default ImageItem;
