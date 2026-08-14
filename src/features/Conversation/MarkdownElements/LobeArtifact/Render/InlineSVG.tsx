'use client';

import { sanitizeSVGContent } from '@lobechat/utils/client';
import { Button, Tooltip } from '@lobehub/ui';
import { App } from 'antd';
import { createStyles } from 'antd-style';
import { PanelRightOpen } from 'lucide-react';
import { memo, useContext, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Center, Flexbox } from 'react-layout-kit';

import SVGDiagram from '@/components/SVGDiagram';
import { useChatStore } from '@/store/chat';
import { chatPortalSelectors, chatSelectors } from '@/store/chat/selectors';
import { dotLoading } from '@/styles/loading';

import { InPortalThreadContext } from '../../../context/InPortalThreadContext';
import Card, { ArtifactProps } from './Card';

const useStyles = createStyles(({ css, token }) => ({
  skeleton: css`
    margin-block-start: 12px;

    height: 200px;
    border: 1px dashed ${token.colorBorderSecondary};
    border-radius: 8px;

    color: ${token.colorTextTertiary};

    background: ${token.colorFillQuaternary};
  `,
}));

/**
 * Inline rendering for `image/svg+xml` artifacts: a drawing skeleton while the
 * tag streams, the themed diagram once it closes, and the classic artifact
 * card as fallback when generation aborted or sanitization leaves nothing.
 */
const InlineSVG = memo<ArtifactProps>((props) => {
  const { id, identifier, language, title, type } = props;
  const { t } = useTranslation('chat');
  const { styles, cx } = useStyles();

  const inThread = useContext(InPortalThreadContext);
  const { message } = App.useApp();
  const [isGenerating, isArtifactTagClosed, code, openArtifact] = useChatStore((s) => {
    return [
      chatSelectors.isMessageGenerating(id)(s),
      chatPortalSelectors.isArtifactTagClosed(id)(s),
      chatPortalSelectors.artifactCode(id)(s),
      s.openArtifact,
    ];
  });

  // only worth computing once the tag closed; while streaming the code is partial
  const isRenderable = useMemo(
    () => isArtifactTagClosed && !!sanitizeSVGContent(code).trim(),
    [code, isArtifactTagClosed],
  );

  if (!isArtifactTagClosed && isGenerating)
    return (
      <Center className={styles.skeleton} width={'100%'}>
        <Flexbox className={cx(dotLoading)} horizontal>
          {title || t('artifact.drawing')}
        </Flexbox>
      </Center>
    );

  if (!isRenderable) return <Card {...props} />;

  return (
    <SVGDiagram content={code} title={title} variant={'inline'}>
      <Tooltip title={t('artifact.viewInPortal')}>
        <Button
          icon={PanelRightOpen}
          onClick={() => {
            if (inThread) {
              message.info(t('artifact.inThread'));
              return;
            }
            openArtifact({ id, identifier, language, title, type });
          }}
          size={'small'}
        />
      </Tooltip>
    </SVGDiagram>
  );
});

export default InlineSVG;
