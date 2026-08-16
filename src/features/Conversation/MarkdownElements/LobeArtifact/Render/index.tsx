import { ArtifactType } from '@lobechat/types';
import { memo, useEffect, useRef } from 'react';

import { useChatStore } from '@/store/chat';
import { chatSelectors } from '@/store/chat/selectors';
import { useServerConfigStore } from '@/store/serverConfig';

import Card, { ArtifactProps } from './Card';
import InlineSVG from './InlineSVG';

const Render = memo<ArtifactProps>((props) => {
  const { identifier, title, type, language, children, id } = props;

  const hasChildren = !!children;
  // SVG artifacts render inline in the bubble; every other type keeps the card
  // + side-portal behavior
  const isSVGArtifact = type === ArtifactType.SVG;
  const isMobile = useServerConfigStore((s) => s.isMobile);

  const [isGenerating, openArtifact] = useChatStore((s) => {
    return [chatSelectors.isMessageGenerating(id)(s), s.openArtifact];
  });

  // Open the portal once when a non-SVG artifact starts streaming. The previous
  // effect had the streaming body in its deps and re-opened on every chunk,
  // which on mobile re-covered the screen each tick and fought a user trying to
  // dismiss it. Now: open at most once per generation, and never auto-open on
  // mobile (the inline Card is shown; the user opens the portal manually). The
  // portal reads live content via chatPortalSelectors.artifactCode(id), so it
  // keeps updating without re-calling openArtifact.
  const openedRef = useRef(false);
  useEffect(() => {
    if (!isGenerating) {
      openedRef.current = false;
      return;
    }
    if (isSVGArtifact || !hasChildren || isMobile || openedRef.current) return;
    openedRef.current = true;
    openArtifact({ id, identifier, language, title, type });
  }, [isSVGArtifact, isGenerating, hasChildren, isMobile, identifier, title, type, id, language]);

  if (isSVGArtifact && hasChildren) return <InlineSVG {...props} />;

  return <Card {...props} />;
});

export default Render;
