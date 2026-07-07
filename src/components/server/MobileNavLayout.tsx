import { ReactNode } from 'react';
import { Flexbox, type FlexboxProps } from 'react-layout-kit';

import { MOBILE_TABBAR_HEIGHT } from '@/const/layoutTokens';

interface MobileContentLayoutProps extends FlexboxProps {
  header?: ReactNode;
  withNav?: boolean;
}

const MobileContentLayout = ({
  children,
  withNav,
  style,
  header,
  id = 'lobe-mobile-scroll-container',
  ...rest
}: MobileContentLayoutProps) => {
  const content = (
    <Flexbox
      height="100%"
      id={id}
      style={{
        overflowX: 'hidden',
        overflowY: 'auto',
        position: 'relative',
        ...style,
        // TabNav height plus the browser safe-area inset.
        paddingBottom: withNav ? `calc(${MOBILE_TABBAR_HEIGHT}px + env(safe-area-inset-bottom))` : style?.paddingBottom,
      }}
      width="100%"
      {...rest}
    >
      {children}
    </Flexbox>
  );

  if (!header) return content;

  return (
    <Flexbox height={'100%'} style={{ overflow: 'hidden', position: 'relative' }} width={'100%'}>
      {header}
      <Flexbox
        height="100%"
        id={'lobe-mobile-scroll-container'}
        style={{
          overflowX: 'hidden',
          overflowY: 'auto',
          position: 'relative',
          ...style,
          // TabNav height plus the browser safe-area inset.
          paddingBottom: withNav ? `calc(${MOBILE_TABBAR_HEIGHT}px + env(safe-area-inset-bottom))` : style?.paddingBottom,
        }}
        width="100%"
        {...rest}
      >
        {children}
      </Flexbox>
    </Flexbox>
  );
};

MobileContentLayout.displayName = 'MobileContentLayout';

export default MobileContentLayout;
