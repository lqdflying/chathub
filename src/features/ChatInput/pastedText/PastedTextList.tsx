'use client';

import { memo } from 'react';
import { Flexbox } from 'react-layout-kit';

import PastedTextCard from './PastedTextCard';
import { usePastedTextStore } from './store';

const PastedTextList = memo(() => {
  const items = usePastedTextStore((s) => s.items);
  const removePastedText = usePastedTextStore((s) => s.removePastedText);

  if (items.length === 0) return null;

  return (
    <Flexbox gap={6} horizontal paddingBlock={8} paddingInline={12} style={{ flexWrap: 'wrap' }}>
      {items.map((item) => (
        <PastedTextCard
          content={item.content}
          key={item.id}
          onRemove={() => {
            removePastedText(item.id);
          }}
        />
      ))}
    </Flexbox>
  );
});

PastedTextList.displayName = 'PastedTextList';

export default PastedTextList;
