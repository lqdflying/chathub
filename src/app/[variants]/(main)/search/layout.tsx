import ServerLayout from '@/components/server/ServerLayout';

import Desktop from './_layout/Desktop';
import Mobile from './_layout/Mobile';
import { LayoutProps } from './_layout/type';

const SearchLayout = ServerLayout<LayoutProps>({ Desktop, Mobile });

SearchLayout.displayName = 'SearchLayout';

export default SearchLayout;
