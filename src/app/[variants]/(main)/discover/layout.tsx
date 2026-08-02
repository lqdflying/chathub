import type { Metadata } from 'next';
import type { PropsWithChildren } from 'react';

export const metadata: Metadata = {
  robots: {
    follow: true,
    index: false,
  },
};

const DiscoverLayout = ({ children }: PropsWithChildren) => children;

export default DiscoverLayout;
