import { PropsWithChildren } from 'react';
import { Flexbox } from 'react-layout-kit';

import ProviderMenu from '../../ProviderMenu';
import Container from './Container';

const Layout = ({
  children,
  onProviderSelect,
}: PropsWithChildren & {
  onProviderSelect: (providerKey: string) => void;
}) => {
  return (
    <Flexbox
      horizontal
      style={{
        maxHeight: '100vh',
        minWidth: 0,
        width: '100%',
      }}
      width={'100%'}
    >
      <ProviderMenu mobile={false} onProviderSelect={onProviderSelect} />
      {/* Flex min-width: auto is min-content; a long Select option must not widen this pane.
          @see https://developer.mozilla.org/en-US/docs/Web/CSS/min-width
          @see https://stackoverflow.com/questions/36247140/why-dont-flex-items-shrink-past-content-size */}
      <Flexbox flex={1} style={{ minWidth: 0, overflow: 'hidden' }}>
        <Container>{children}</Container>
      </Flexbox>
    </Flexbox>
  );
};
export default Layout;
