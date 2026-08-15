import { memo } from 'react';

import { useGenerationConfigParam } from '@/store/image/slices/generationConfig/hooks';
import { useImageStore } from '@/store/image/store';

import Select from '../../../components/SizeSelect';

const SizeSelect = memo(() => {
  const { value, setValue, enumValues } = useGenerationConfigParam('size');
  const sizeSchema = useImageStore((state) => state.parametersSchema?.size);
  const options = (enumValues ?? []).map((size) => ({
    label: size,
    value: size,
  }));

  return <Select onChange={setValue} options={options} sizeSchema={sizeSchema} value={value} />;
});

export default SizeSelect;
