import { ActionIcon, ActionIconProps } from '@lobehub/ui';
import { Github } from 'lucide-react';
import Link from 'next/link';
import { memo } from 'react';
import { Flexbox } from 'react-layout-kit';

import { TOUCH_TARGET_SIZE } from '@/const/layoutTokens';
import { GITHUB } from '@/const/url';
import { featureFlagsSelectors, useServerConfigStore } from '@/store/serverConfig';

import PHLaunch from './PHLaunch';

const ICON_SIZE: ActionIconProps['size'] = {
  blockSize: TOUCH_TARGET_SIZE,
  size: 18,
  strokeWidth: 1.5,
};

const BottomActions = memo(() => {
  const { hideGitHub } = useServerConfigStore(featureFlagsSelectors);

  return (
    <Flexbox gap={6}>
      {!hideGitHub && (
        <Link aria-label={'GitHub'} href={GITHUB} target={'_blank'}>
          <ActionIcon
            icon={Github}
            size={ICON_SIZE}
            title={'GitHub'}
            tooltipProps={{ placement: 'right' }}
          />
        </Link>
      )}
      <PHLaunch />
    </Flexbox>
  );
});

export default BottomActions;
