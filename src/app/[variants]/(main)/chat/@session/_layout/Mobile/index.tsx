import { PropsWithChildren } from 'react';

import MobileContentLayout from '@/components/server/MobileNavLayout';

import SessionSearchBar from '../../features/SessionSearchBar';
import SessionHeader from './SessionHeader';

const MobileLayout = ({ children }: PropsWithChildren) => {
  return (
    <MobileContentLayout header={<SessionHeader />} withNav>
      <div style={{ padding: '10px 14px 8px' }}>
        <SessionSearchBar mobile />
      </div>
      {children}
      {/* ↓ cloud slot ↓ */}

      {/* ↑ cloud slot ↑ */}
    </MobileContentLayout>
  );
};

export default MobileLayout;
