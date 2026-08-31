import { SortableList } from '@lobehub/ui';
import { AiProviderModelListItem } from 'model-bank';
import { memo } from 'react';
import { Flexbox } from 'react-layout-kit';

import { ModelBrandIcon } from '@/components/ProviderBrandIcon';

const ListItem = memo<AiProviderModelListItem>(({ id, displayName }) => {
  return (
    <>
      <Flexbox gap={8} horizontal>
        <ModelBrandIcon model={id} size={24} type={'avatar'} />
        {displayName || id}
      </Flexbox>
      <SortableList.DragHandle />
    </>
  );
});

export default ListItem;
