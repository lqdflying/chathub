import { BrandLoading } from '@lobehub/ui/brand';
import { Center } from 'react-layout-kit';

import { BRANDING_NAME } from '@/const/branding';

import CircleLoading from '../CircleLoading';

export default () => {
  return (
    <Center height={'100%'} width={'100%'}>
      <BrandLoading size={40} style={{ opacity: 0.6 }} text={BRANDING_NAME} />
    </Center>
  );
};
