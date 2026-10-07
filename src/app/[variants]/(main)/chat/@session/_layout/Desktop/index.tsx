import { PropsWithChildren } from 'react';
import { Flexbox } from 'react-layout-kit';

import PanelBody from './PanelBody';
import Header from './SessionHeader';

const DesktopLayout = ({ children }: PropsWithChildren) => {
  return (
    <Flexbox height={'100%'} style={{ minHeight: 0 }} width={'100%'}>
      <Header />
      <PanelBody>{children}</PanelBody>
      {/* ↓ cloud slot ↓ */}

      {/* ↑ cloud slot ↑ */}
    </Flexbox>
  );
};

export default DesktopLayout;
