import type { FormProps } from '@lobehub/ui';
import { useMemo } from 'react';

import { FORM_STYLE } from '@/const/layoutTokens';
import { useIsMobile } from '@/hooks/useIsMobile';

export const useSettingsFormStyle = (): FormProps => {
  const isMobile = useIsMobile();

  return useMemo(
    () => ({
      ...FORM_STYLE,
      ...(isMobile && {
        itemMinWidth: undefined,
        layout: 'vertical',
      }),
    }),
    [isMobile],
  );
};
