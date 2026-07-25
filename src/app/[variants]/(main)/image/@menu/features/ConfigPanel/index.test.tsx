import { render, screen } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import ConfigPanel from './index';

const { imageState } = vi.hoisted(() => ({
  imageState: {
    isImageModelAvailable: false,
    isInit: false,
    parametersSchema: {},
  },
}));

vi.mock('antd-style', () => ({
  useTheme: () => ({
    colorBgContainer: '#fff',
    colorBorder: '#ddd',
  }),
}));

vi.mock('@lobehub/ui', () => ({
  Text: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@/store/image/slices/generationConfig/hooks', () => ({
  useDimensionControl: () => ({ showDimensionControl: false }),
}));

vi.mock('@/store/image/store', () => ({
  useImageStore: <T,>(selector: (state: typeof imageState) => T) => selector(imageState),
}));

vi.mock('./components/ImageConfigSkeleton', () => ({
  default: () => <div>image-config-skeleton</div>,
}));
vi.mock('./components/ModelSelect', () => ({
  default: () => <div>model-select</div>,
}));

vi.mock('./components/CfgSliderInput', () => ({
  default: () => <div>parameter-control</div>,
}));
vi.mock('./components/DimensionControlGroup', () => ({
  default: () => <div>parameter-control</div>,
}));
vi.mock('./components/ImageNum', () => ({
  default: () => <div>parameter-control</div>,
}));
vi.mock('./components/ImageUrl', () => ({
  default: () => <div>parameter-control</div>,
}));
vi.mock('./components/ImageUrlsUpload', () => ({
  default: () => <div>parameter-control</div>,
}));
vi.mock('./components/QualitySelect', () => ({
  default: () => <div>parameter-control</div>,
}));
vi.mock('./components/SeedNumberInput', () => ({
  default: () => <div>parameter-control</div>,
}));
vi.mock('./components/SizeSelect', () => ({
  default: () => <div>parameter-control</div>,
}));
vi.mock('./components/StepsSliderInput', () => ({
  default: () => <div>parameter-control</div>,
}));

describe('ConfigPanel', () => {
  beforeEach(() => {
    imageState.isImageModelAvailable = false;
    imageState.isInit = false;
  });

  it('shows the loading skeleton before configuration hydration settles', () => {
    render(<ConfigPanel />);

    expect(screen.getByText('image-config-skeleton')).not.toBeNull();
    expect(screen.queryByText('model-select')).toBeNull();
  });

  it('shows model guidance without stale controls when no model is available', () => {
    imageState.isInit = true;

    render(<ConfigPanel />);

    expect(screen.getByText('model-select')).not.toBeNull();
    expect(screen.queryByText('image-config-skeleton')).toBeNull();
    expect(screen.queryByText('parameter-control')).toBeNull();
  });
});
