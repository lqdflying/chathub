import { fireEvent, render, screen } from '@testing-library/react';
import { ModelParamsSchema } from 'model-bank';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import ModelSelect from './ModelSelect';

interface TestModel {
  abilities?: object;
  id: string;
  parameters?: ModelParamsSchema;
}

const validModelParameters: ModelParamsSchema = {
  prompt: { default: '' },
};

const { aiInfraState, imageState, selectState } = vi.hoisted(() => ({
  aiInfraState: {
    enabledImageModelList: [] as Array<{
      children: TestModel[];
      id: string;
      name: string;
    }>,
  },
  imageState: {
    isImageModelAvailable: false,
    model: 'gpt-image-1',
    provider: 'openai',
    setModelAndProviderOnSelect: vi.fn(),
  },
  selectState: {
    onChange: undefined as
      ((value: string, option: { provider?: string; value: string }) => void) | undefined,
  },
}));

vi.mock('@lobehub/ui', () => ({
  ActionIcon: () => <button type="button">settings</button>,
  Icon: () => <span>icon</span>,
  Select: ({
    onChange,
    options,
    value,
  }: {
    onChange: (value: string, option: { provider?: string; value: string }) => void;
    options?: Array<{
      options?: Array<{ value: string }>;
      value?: string;
    }>;
    value?: string;
  }) => {
    selectState.onChange = onChange;
    const optionValues: string[] = [];
    for (const option of options ?? []) {
      if (option.options) {
        for (const childOption of option.options) {
          optionValues.push(childOption.value);
        }
      } else if (option.value) {
        optionValues.push(option.value);
      }
    }

    return (
      <button
        data-options={optionValues.join(',')}
        data-testid="model-select"
        data-value={value ?? ''}
        onClick={() =>
          selectState.onChange?.('openai/gpt-image-1', {
            provider: 'openai',
            value: 'openai/gpt-image-1',
          })
        }
        type="button"
      />
    );
  },
}));

vi.mock('antd-style', () => ({
  createStyles() {
    return function useStyles() {
      return { styles: { popup: 'popup' } };
    };
  },
  useTheme: () => ({ colorTextTertiary: '#999' }),
}));

vi.mock('next/link', () => ({
  default: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('react-layout-kit', () => ({
  Flexbox: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('@/components/ModelSelect', () => ({
  ModelItemRender: () => <span>model</span>,
  ProviderItemRender: () => <span>provider</span>,
}));

vi.mock('@/store/aiInfra', () => ({
  aiProviderSelectors: {
    enabledImageModelList: (state: typeof aiInfraState) => state.enabledImageModelList,
  },
  getAiInfraStoreState: () => aiInfraState,
  useAiInfraStore: <T,>(selector: (state: typeof aiInfraState) => T) => selector(aiInfraState),
}));

vi.mock('@/store/aiInfra/slices/aiProvider/selectors', () => ({
  aiProviderSelectors: {
    enabledImageModelList: (state: typeof aiInfraState) => state.enabledImageModelList,
  },
}));

vi.mock('@/store/image', () => ({
  useImageStore: <T,>(selector: (state: typeof imageState) => T) => selector(imageState),
}));

vi.mock('@/store/image/slices/generationConfig/selectors', () => ({
  imageGenerationConfigSelectors: {
    model: (state: typeof imageState) => state.model,
    provider: (state: typeof imageState) => state.provider,
  },
}));

vi.mock('@/store/serverConfig', () => ({
  featureFlagsSelectors: vi.fn(),
  useServerConfigStore: () => ({ showLLM: false }),
}));

describe('ModelSelect', () => {
  beforeEach(() => {
    aiInfraState.enabledImageModelList = [];
    imageState.isImageModelAvailable = false;
    imageState.model = 'gpt-image-1';
    imageState.provider = 'openai';
    imageState.setModelAndProviderOnSelect.mockReset();
    selectState.onChange = undefined;
  });

  it('hides stale provider and model values when no image model is available', () => {
    render(<ModelSelect />);

    expect(screen.getByTestId('model-select').dataset.value).toBe('');
  });

  it('shows the current provider and model when the selection is available', () => {
    aiInfraState.enabledImageModelList = [
      {
        children: [{ id: 'gpt-image-1', parameters: validModelParameters }],
        id: 'openai',
        name: 'OpenAI',
      },
    ];
    imageState.isImageModelAvailable = true;

    render(<ModelSelect />);

    expect(screen.getByTestId('model-select').dataset.value).toBe('openai/gpt-image-1');
  });

  it('dispatches the same usable model to recover unavailable state', () => {
    aiInfraState.enabledImageModelList = [
      {
        children: [{ id: 'gpt-image-1', parameters: validModelParameters }],
        id: 'openai',
        name: 'OpenAI',
      },
    ];

    render(<ModelSelect />);
    fireEvent.click(screen.getByTestId('model-select'));

    expect(imageState.setModelAndProviderOnSelect).toHaveBeenCalledWith('gpt-image-1', 'openai');
  });

  it('filters schema-less models while keeping usable alternatives selectable', () => {
    aiInfraState.enabledImageModelList = [
      {
        children: [
          { id: 'schema-less-model' },
          { id: 'gpt-image-1', parameters: validModelParameters },
        ],
        id: 'openai',
        name: 'OpenAI',
      },
    ];

    render(<ModelSelect />);

    expect(screen.getByTestId('model-select').dataset.options).toBe('openai/gpt-image-1');
  });

  it('shows empty guidance when every enabled model is unusable', () => {
    aiInfraState.enabledImageModelList = [
      {
        children: [{ id: 'schema-less-model' }],
        id: 'openai',
        name: 'OpenAI',
      },
    ];

    render(<ModelSelect />);

    expect(screen.getByTestId('model-select').dataset.options).toBe('openai/empty');
  });

  it('ignores a stale selection event after the model becomes unusable', () => {
    aiInfraState.enabledImageModelList = [
      {
        children: [{ id: 'gpt-image-1', parameters: validModelParameters }],
        id: 'openai',
        name: 'OpenAI',
      },
    ];
    imageState.model = 'other-model';

    render(<ModelSelect />);
    aiInfraState.enabledImageModelList[0].children[0].parameters = undefined;
    fireEvent.click(screen.getByTestId('model-select'));

    expect(imageState.setModelAndProviderOnSelect).not.toHaveBeenCalled();
  });
});
