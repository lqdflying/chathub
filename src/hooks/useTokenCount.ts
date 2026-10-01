import { debounce } from 'lodash-es';
import { startTransition, useCallback, useEffect, useState } from 'react';

import { countContextTextTokens } from '@/helpers/contextTokenCount';
import { fallbackTokenCount } from '@/utils/tokenizer';

export const useTokenCount = (input: string = '') => {
  const [value, setNum] = useState(0);

  const debouncedEncode = useCallback(
    debounce((text: string) => {
      countContextTextTokens(text)
        .then((counted) => setNum(counted.count))
        .catch(() => {
          setNum(fallbackTokenCount(text));
        });
    }, 300),
    [],
  );

  useEffect(() => {
    startTransition(() => {
      debouncedEncode(input || '');
    });

    // 清理函数
    return () => {
      debouncedEncode.cancel();
    };
  }, [input, debouncedEncode]);

  return value;
};
