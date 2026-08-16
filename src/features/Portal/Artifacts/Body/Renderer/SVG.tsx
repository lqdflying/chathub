import { memo } from 'react';

import SVGDiagram from '@/components/SVGDiagram';
import { useChatStore } from '@/store/chat';
import { chatPortalSelectors } from '@/store/chat/selectors';

interface SVGRendererProps {
  content: string;
}

const SVGRenderer = memo<SVGRendererProps>(({ content }) => {
  const title = useChatStore(chatPortalSelectors.artifactTitle);

  return <SVGDiagram content={content} title={title} variant={'portal'} />;
});

export default SVGRenderer;
