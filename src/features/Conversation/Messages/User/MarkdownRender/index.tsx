import { Flexbox } from 'react-layout-kit';

import PastedTextCard from '@/features/ChatInput/pastedText/PastedTextCard';
import { shouldCollapsePastedText } from '@/features/ChatInput/pastedText/helpers';
import { useChatStore } from '@/store/chat';

import { MarkdownCustomRender } from '../../../types';

export const MarkdownRender: MarkdownCustomRender = ({ text, dom, id }) => {
  const openMessageDetail = useChatStore((s) => s.openMessageDetail);

  if (shouldCollapsePastedText(text))
    return (
      <Flexbox>
        <PastedTextCard
          content={text}
          onOpen={() => {
            openMessageDetail(id);
          }}
        />
      </Flexbox>
    );

  return dom;
};
