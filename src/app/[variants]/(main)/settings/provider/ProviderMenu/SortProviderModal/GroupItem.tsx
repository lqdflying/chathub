import { ProviderIcon } from '@lobehub/icons';
import { Avatar, SortableList } from '@lobehub/ui';
import { memo } from 'react';
import { Flexbox } from 'react-layout-kit';

import { AiProviderListItem } from '@/types/aiProvider';

import { resolveProviderIcon } from '../../utils/resolveProviderIcon';

const GroupItem = memo<AiProviderListItem>(({ id, name, source, logo }) => {
  return (
    <>
      <Flexbox gap={8} horizontal>
        {source === 'custom' && logo ? (
          <Avatar
            alt={name || id}
            avatar={logo}
            shape={'square'}
            size={24}
            style={{ borderRadius: 6 }}
          />
        ) : (
          <ProviderIcon provider={resolveProviderIcon(id)} size={24} style={{ borderRadius: 6 }} type={'avatar'} />
        )}
        {name}
      </Flexbox>
      <SortableList.DragHandle />
    </>
  );
});

export default GroupItem;
