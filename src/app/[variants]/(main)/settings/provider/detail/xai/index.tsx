import { XaiProviderCard } from '@/config/modelProviders';

import ProviderDetail from '../default';
import XaiOAuthSignIn from './XaiOAuthSignIn';

const Page = () => {
  return (
    <ProviderDetail
      {...XaiProviderCard}
      extra={<XaiOAuthSignIn />}
      settings={{
        ...XaiProviderCard.settings,
        proxyUrl: {
          placeholder: 'https://api.x.ai/v1',
        },
        showApiKey: true,
      }}
    />
  );
};

export default Page;
