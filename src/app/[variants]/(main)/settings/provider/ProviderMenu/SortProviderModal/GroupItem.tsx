import { Avatar, SortableList } from '@lobehub/ui';
import { memo } from 'react';
import { Flexbox } from 'react-layout-kit';

import {
  PROVIDER_SETTINGS_AVATAR_STYLE,
  ProviderBrandIcon,
} from '@/components/ProviderBrandIcon';
import { AiProviderListItem } from '@/types/aiProvider';

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
          <ProviderBrandIcon
            provider={id}
            size={24}
            style={PROVIDER_SETTINGS_AVATAR_STYLE}
            type={'avatar'}
          />
        )}
        {name}
      </Flexbox>
      <SortableList.DragHandle />
    </>
  );
});

export default GroupItem;
