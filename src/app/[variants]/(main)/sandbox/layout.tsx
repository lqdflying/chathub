import { notFound } from 'next/navigation';

import ServerLayout from '@/components/server/ServerLayout';
import { isSandboxConfigured } from '@/server/services/sandbox/registry';
import { DynamicLayoutProps } from '@/types/next';

import Desktop from './_layout/Desktop';
import Mobile from './_layout/Mobile';
import { LayoutProps } from './_layout/type';

const SandboxHubShell = ServerLayout<LayoutProps>({ Desktop, Mobile });

/** Hidden (404) when no Sandbox Hub profile can run on this server. */
const SandboxHubLayout = (props: LayoutProps & DynamicLayoutProps) => {
  if (!isSandboxConfigured()) return notFound();
  const Shell = SandboxHubShell as unknown as (shellProps: LayoutProps & DynamicLayoutProps) => any;
  return <Shell {...props} />;
};

SandboxHubLayout.displayName = 'SandboxHubLayout';

export default SandboxHubLayout;
