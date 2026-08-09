import ServerLayout from '@/components/server/ServerLayout';

import Desktop from './_layout/Desktop';
import Mobile from './_layout/Mobile';
import { LayoutProps } from './_layout/type';

const ToolsLayout = ServerLayout<LayoutProps>({ Desktop, Mobile });

ToolsLayout.displayName = 'ToolsLayout';

export default ToolsLayout;
