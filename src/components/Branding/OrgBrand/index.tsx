import { memo } from 'react';

import { BRANDING_NAME } from '@/const/branding';

export const OrgBrand = memo(() => {
  return <span>{BRANDING_NAME}</span>;
});
