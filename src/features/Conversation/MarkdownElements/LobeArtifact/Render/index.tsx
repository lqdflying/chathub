import { ArtifactType } from '@lobechat/types';
import { memo, useEffect } from 'react';

import { useChatStore } from '@/store/chat';
import { chatSelectors } from '@/store/chat/selectors';

import Card, { ArtifactProps } from './Card';
import InlineSVG from './InlineSVG';

const Render = memo<ArtifactProps>((props) => {
  const { identifier, title, type, language, children, id } = props;

  const hasChildren = !!children;
  const str = ((children as string) || '').toString?.();
  // SVG artifacts render inline in the bubble; every other type keeps the
  // card + side-portal behavior
  const isSVGArtifact = type === ArtifactType.SVG;

  const [isGenerating, openArtifact] = useChatStore((s) => {
    return [chatSelectors.isMessageGenerating(id)(s), s.openArtifact];
  });

  useEffect(() => {
    if (isSVGArtifact || !hasChildren || !isGenerating) return;

    openArtifact({ id, identifier, language, title, type });
  }, [isSVGArtifact, isGenerating, hasChildren, str, identifier, title, type, id, language]);

  if (isSVGArtifact && hasChildren) return <InlineSVG {...props} />;

  return <Card {...props} />;
});

export default Render;
