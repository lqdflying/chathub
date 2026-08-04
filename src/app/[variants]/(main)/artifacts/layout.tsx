import ServerLayout from '@/components/server/ServerLayout';

import Desktop from './_layout/Desktop';
import Mobile from './_layout/Mobile';
import { LayoutProps } from './_layout/type';

const ArtifactsLayout = ServerLayout<LayoutProps>({ Desktop, Mobile });

ArtifactsLayout.displayName = 'ArtifactsLayout';

export default ArtifactsLayout;
