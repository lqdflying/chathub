import { type ReactNode } from 'react';
import { Flexbox } from 'react-layout-kit';

import InfoTooltip from '@/components/InfoTooltip';

export const withTooltip = (title: string, tooltip: string): ReactNode => (
  <Flexbox align={'center'} gap={6} horizontal>
    {title}
    <InfoTooltip title={tooltip} />
  </Flexbox>
);
