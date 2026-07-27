import { act, renderHook, waitFor } from '@testing-library/react';
import {
  ModelParamsSchema,
  RuntimeImageGenParams,
  extractDefaultValues,
  gptImage2CompatibleParamsSchema,
} from 'model-bank';
import { AIImageModelCard } from 'model-bank';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { INITIAL_STATUS } from '@/store/global/initialState';
import { useGlobalStore } from '@/store/global/store';
import { useImageStore } from '@/store/image';
import { useUserStore } from '@/store/user';
import { authSelectors } from '@/store/user/selectors';

import { testFluxSchnellParamsSchema } from './test-fixtures';

const fluxSchnellParamsSchema = testFluxSchnellParamsSchema;

const { currentImageSettingsMock, updateImageConfigMock } = vi.hoisted(() => ({
  currentImageSettingsMock: vi.fn(() => ({
    defaultImageNum: 4,
  })),
  updateImageConfigMock: vi.fn(() => Promise.resolve()),
}));

vi.mock('@/services/user', () => ({
  userService: {
    updateImageConfig: updateImageConfigMock,
  },
}));

vi.mock('@/store/user/slices/settings/selectors', () => ({
  settingsSelectors: {
    currentImageSettings: currentImageSettingsMock,
  },
}));

// Test fixtures
const customModelSchema: ModelParamsSchema = {
  prompt: { default: '' },
  width: { default: 1024, min: 256, max: 2048, step: 64 },
  height: { default: 1024, min: 256, max: 2048, step: 64 },
  steps: { default: 20, min: 1, max: 50 },
};

const sizeCapableModelSchema: ModelParamsSchema = {
  prompt: { default: '' },
  size: { default: '1024x1024', enum: ['1024x1024', '1536x1024'] },
};

const testImageModels: AIImageModelCard[] = [
  {
    id: 'flux/schnell',
    displayName: 'FLUX.1 Schnell',
    type: 'image',
    parameters: fluxSchnellParamsSchema,
    releasedAt: '2024-08-01',
  },
  {
    id: 'custom-model',
    displayName: 'Custom Model',
    type: 'image',
    parameters: customModelSchema,
    releasedAt: '2024-01-01',
  },
  {
    id: 'size-model',
    displayName: 'Size Model',
    type: 'image',
    parameters: sizeCapableModelSchema,
    releasedAt: '2024-01-01',
  },
  {
    id: 'gpt-image-2',
    displayName: 'GPT Image 2',
    type: 'image',
    parameters: gptImage2CompatibleParamsSchema,
    releasedAt: '2026-01-01',
  },
];

const mockProviders = [
  {
    id: 'fal',
    name: 'Fal',
    children: [testImageModels[0]],
  },
  {
    id: 'custom-provider',
    name: 'Custom Provider',
    children: [testImageModels[1], testImageModels[2]],
  },
  {
    id: 'openaicompatible',
    name: 'OpenAI Compatible',
    children: [testImageModels[3]],
  },
];

// Mock external dependencies
vi.mock('@/store/aiInfra', () => ({
  aiProviderSelectors: {
    enabledImageModelList: vi.fn(() => mockProviders),
  },
  getAiInfraStoreState: vi.fn(() => ({})),
}));

// Test data
const fluxSchnellDefaultValues = extractDefaultValues(fluxSchnellParamsSchema);
const customModelDefaultValues = extractDefaultValues(customModelSchema);
const sizeCapableModelDefaultValues = extractDefaultValues(sizeCapableModelSchema);

const initialTestState = {
  isImageModelAvailable: false,
  isInit: false,
  model: 'initial-model',
  provider: 'initial-provider',
  imageNum: 1,
  parameters: {
    prompt: 'initial prompt',
    width: 512,
    height: 512,
  } satisfies Partial<RuntimeImageGenParams>,
  parametersSchema: {
    prompt: { default: '' },
    width: { default: 512, min: 256, max: 1024 },
    height: { default: 512, min: 256, max: 1024 },
  } satisfies ModelParamsSchema,
};

beforeEach(() => {
  vi.clearAllMocks();
  updateImageConfigMock.mockClear();
  currentImageSettingsMock.mockReturnValue({ defaultImageNum: 4 });
  mockProviders[0].children = [testImageModels[0]];
  mockProviders[1].children = [testImageModels[1], testImageModels[2]];
  mockProviders[2].children = [testImageModels[3]];
  useGlobalStore.setState({
    isStatusInit: true,
    status: { ...INITIAL_STATUS },
  });
  // Default to the guest (signed-out) browser-local write path; individual
  // tests opt into the signed-in DB path by stubbing isLogin to true.
  vi.spyOn(authSelectors, 'isLogin').mockReturnValue(false);
  useUserStore.setState({
    isUserStateInit: true,
    user: { id: 'user-id' },
    userStateOwnerId: 'user-id',
  });
  useImageStore.setState(initialTestState);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('GenerationConfigAction', () => {
  // Helper function to create test parameters
  const createTestParameters = (overrides: Partial<RuntimeImageGenParams> = {}) =>
    ({
      prompt: '',
      width: 512,
      height: 512,
      ...overrides,
    }) satisfies Partial<RuntimeImageGenParams>;

  // Helper function to create test schema
  const createTestSchema = (overrides: Partial<ModelParamsSchema> = {}) =>
    ({
      prompt: { default: '' },
      width: { default: 512, min: 256, max: 2048 },
      height: { default: 512, min: 256, max: 2048 },
      ...overrides,
    }) satisfies ModelParamsSchema;

  describe('Parameter Management', () => {
    it('should update individual parameters via setParamOnInput', () => {
      const { result } = renderHook(() => useImageStore());

      act(() => {
        result.current.setParamOnInput('prompt', 'new test prompt');
      });

      expect(result.current.parameters).toMatchObject({
        prompt: 'new test prompt',
        width: 512,
        height: 512,
      });
    });

    it('should handle different parameter types (string, number, null, array)', () => {
      const { result } = renderHook(() => useImageStore());

      act(() => {
        result.current.setParamOnInput('width', 2048);
        result.current.setParamOnInput('seed', null);
        result.current.setParamOnInput('imageUrls', ['test1.jpg', 'test2.jpg']);
      });

      expect(result.current.parameters).toMatchObject({
        width: 2048,
        seed: null,
        imageUrls: ['test1.jpg', 'test2.jpg'],
      });
    });

    it('should update imageNum independently', () => {
      const { result } = renderHook(() => useImageStore());

      act(() => {
        result.current.setImageNum(4);
      });

      expect(result.current.imageNum).toBe(4);
    });

    it('should persist a valid selected image count', () => {
      const { result } = renderHook(() => useImageStore());

      act(() => {
        result.current.setImageNum(8);
      });

      expect(useGlobalStore.getState().status.lastSelectedImageNum).toBe(8);
      expect(updateImageConfigMock).not.toHaveBeenCalled();
    });

    it('should persist image config to the DB-backed preference when signed in', async () => {
      vi.mocked(authSelectors.isLogin).mockReturnValue(true);
      const { result } = renderHook(() => useImageStore());

      act(() => {
        result.current.setModelAndProviderOnSelect('size-model', 'custom-provider');
        result.current.setImageNum(8);
        result.current.setParamOnInput('size', '1536x1024');
      });

      await waitFor(() => {
        expect(updateImageConfigMock).toHaveBeenLastCalledWith({
          imageNum: 8,
          model: 'size-model',
          provider: 'custom-provider',
          size: '1536x1024',
        });
      });
      // Signed-in writes must not touch the browser-local legacy keys.
      expect(useGlobalStore.getState().status.lastSelectedImageNum).toBeUndefined();
    });

    it('should handle edge case values for imageNum', () => {
      const { result } = renderHook(() => useImageStore());

      act(() => {
        result.current.setImageNum(0);
      });

      expect(result.current.imageNum).toBe(0);
      expect(useGlobalStore.getState().status.lastSelectedImageNum).toBeUndefined();
    });
  });

  describe('Model and Provider Selection', () => {
    it('should set complete configuration for flux/schnell model', () => {
      const { result } = renderHook(() => useImageStore());

      act(() => {
        result.current.setModelAndProviderOnSelect('flux/schnell', 'fal');
      });

      expect(result.current.model).toBe('flux/schnell');
      expect(result.current.provider).toBe('fal');
      expect(result.current.parameters).toEqual(fluxSchnellDefaultValues);
      expect(result.current.parametersSchema).toEqual(fluxSchnellParamsSchema);
    });

    it('should handle custom model configuration', () => {
      const { result } = renderHook(() => useImageStore());

      act(() => {
        result.current.setModelAndProviderOnSelect('custom-model', 'custom-provider');
      });

      expect(result.current.model).toBe('custom-model');
      expect(result.current.provider).toBe('custom-provider');
      expect(result.current.parameters).toEqual(customModelDefaultValues);
      expect(result.current.parametersSchema).toEqual(customModelSchema);
    });

    it('should completely replace parameters when switching models', () => {
      const { result } = renderHook(() => useImageStore());

      // Set some custom parameters
      act(() => {
        result.current.setParamOnInput('prompt', 'custom prompt');
        result.current.setParamOnInput('steps', 50);
      });

      // Switch model
      act(() => {
        result.current.setModelAndProviderOnSelect('flux/schnell', 'fal');
      });

      expect(result.current.parameters).toEqual(fluxSchnellDefaultValues);
      expect(result.current.parameters?.prompt).toBe('');
    });

    it('should persist and clear model-specific image size preferences', () => {
      const { result } = renderHook(() => useImageStore());

      act(() => {
        result.current.setImageNum(8);
        result.current.setModelAndProviderOnSelect('size-model', 'custom-provider');
        result.current.setParamOnInput('size', '1536x1024');
      });

      expect(useGlobalStore.getState().status).toMatchObject({
        lastSelectedImageModel: 'size-model',
        lastSelectedImageNum: 8,
        lastSelectedImageProvider: 'custom-provider',
        lastSelectedImageSize: '1536x1024',
      });

      act(() => {
        result.current.setModelAndProviderOnSelect('custom-model', 'custom-provider');
      });

      expect(result.current.imageNum).toBe(8);
      expect(useGlobalStore.getState().status.lastSelectedImageSize).toBeNull();
    });

    it('should persist a valid custom GPT Image 2 size for guests', () => {
      const { result } = renderHook(() => useImageStore());

      act(() => {
        result.current.setModelAndProviderOnSelect('gpt-image-2', 'openaicompatible');
        result.current.setParamOnInput('size', '2048x2048');
      });

      expect(useGlobalStore.getState().status).toMatchObject({
        lastSelectedImageModel: 'gpt-image-2',
        lastSelectedImageProvider: 'openaicompatible',
        lastSelectedImageSize: '2048x2048',
      });
    });

    it('should persist a valid custom GPT Image 2 size for signed-in users', async () => {
      vi.mocked(authSelectors.isLogin).mockReturnValue(true);
      const { result } = renderHook(() => useImageStore());

      act(() => {
        result.current.setModelAndProviderOnSelect('gpt-image-2', 'openaicompatible');
        result.current.setParamOnInput('size', '2048x2048');
      });

      await waitFor(() => {
        expect(updateImageConfigMock).toHaveBeenLastCalledWith({
          imageNum: 1,
          model: 'gpt-image-2',
          provider: 'openaicompatible',
          size: '2048x2048',
        });
      });
    });

    it('should not persist an invalid GPT Image 2 custom size', () => {
      const { result } = renderHook(() => useImageStore());

      act(() => {
        result.current.setModelAndProviderOnSelect('gpt-image-2', 'openaicompatible');
        result.current.setParamOnInput('size', '1025x1024');
      });

      expect(useGlobalStore.getState().status.lastSelectedImageSize).toBeNull();
    });
  });

  describe('Settings Reuse', () => {
    it('should merge custom settings with model defaults', () => {
      const { result } = renderHook(() => useImageStore());
      const customSettings: Partial<RuntimeImageGenParams> = {
        prompt: 'custom prompt',
        steps: 8,
        seed: 54321,
      };

      act(() => {
        result.current.reuseSettings('flux/schnell', 'fal', customSettings);
      });

      expect(result.current.model).toBe('flux/schnell');
      expect(result.current.provider).toBe('fal');
      expect(result.current.parameters).toEqual({
        ...fluxSchnellDefaultValues,
        ...customSettings,
      });
      expect(result.current.parametersSchema).toEqual(fluxSchnellParamsSchema);
    });

    it('should handle empty and null settings', () => {
      const { result } = renderHook(() => useImageStore());

      act(() => {
        result.current.reuseSettings('flux/schnell', 'fal', {});
      });

      expect(result.current.parameters).toEqual(fluxSchnellDefaultValues);

      act(() => {
        result.current.reuseSettings('flux/schnell', 'fal', { seed: null, imageUrl: null });
      });

      expect(result.current.parameters?.seed).toBeNull();
      expect(result.current.parameters?.imageUrl).toBeNull();
    });

    it('should update only seed parameter via reuseSeed', () => {
      const { result } = renderHook(() => useImageStore());

      act(() => {
        result.current.setParamOnInput('prompt', 'test prompt');
        result.current.reuseSeed(98765);
      });

      expect(result.current.parameters).toMatchObject({
        prompt: 'test prompt',
        width: 512,
        height: 512,
        seed: 98765,
      });
    });

    it('should handle edge case seed values', () => {
      const { result } = renderHook(() => useImageStore());

      act(() => {
        result.current.reuseSeed(0);
      });

      expect(result.current.parameters?.seed).toBe(0);

      const largeSeed = 2147483647;
      act(() => {
        result.current.reuseSeed(largeSeed);
      });

      expect(result.current.parameters?.seed).toBe(largeSeed);
    });
  });

  describe('Aspect Ratio and Dimension Control', () => {
    it('should update width without affecting height when aspect ratio is unlocked', () => {
      const { result } = renderHook(() => useImageStore());

      useImageStore.setState({
        parameters: createTestParameters(),
        parametersSchema: createTestSchema(),
        isAspectRatioLocked: false,
      });

      act(() => {
        result.current.setWidth(1024);
      });

      expect(result.current.parameters).toMatchObject({
        width: 1024,
        height: 512,
      });
    });

    it('should update both dimensions when aspect ratio is locked', () => {
      const { result } = renderHook(() => useImageStore());

      useImageStore.setState({
        parameters: createTestParameters(),
        parametersSchema: createTestSchema(),
        isAspectRatioLocked: true,
        activeAspectRatio: '1:1',
      });

      act(() => {
        result.current.setWidth(1024);
      });

      expect(result.current.parameters).toMatchObject({
        width: 1024,
        height: 1024,
      });
    });

    it('should clamp dimensions to schema bounds when aspect ratio is locked', () => {
      const { result } = renderHook(() => useImageStore());

      useImageStore.setState({
        parameters: createTestParameters(),
        parametersSchema: createTestSchema({
          height: { default: 512, min: 256, max: 1024 },
        }),
        isAspectRatioLocked: true,
        activeAspectRatio: '1:1',
      });

      act(() => {
        result.current.setWidth(2048);
      });

      expect(result.current.parameters).toMatchObject({
        width: 2048,
        height: 1024, // Clamped to max
      });
    });

    it('should update height with proportional width adjustment when locked', () => {
      const { result } = renderHook(() => useImageStore());

      useImageStore.setState({
        parameters: createTestParameters(),
        parametersSchema: createTestSchema(),
        isAspectRatioLocked: true,
        activeAspectRatio: '2:1',
      });

      act(() => {
        result.current.setHeight(512);
      });

      expect(result.current.parameters).toMatchObject({
        width: 1024,
        height: 512,
      });
    });

    it('should toggle aspect ratio lock state', () => {
      const { result } = renderHook(() => useImageStore());

      useImageStore.setState({ isAspectRatioLocked: false });

      act(() => {
        result.current.toggleAspectRatioLock();
      });

      expect(result.current.isAspectRatioLocked).toBe(true);

      act(() => {
        result.current.toggleAspectRatioLock();
      });

      expect(result.current.isAspectRatioLocked).toBe(false);
    });

    it('should adjust dimensions when locking with mismatched ratio', () => {
      const { result } = renderHook(() => useImageStore());

      useImageStore.setState({
        parameters: createTestParameters({ width: 1024, height: 512 }), // 2:1 ratio
        parametersSchema: createTestSchema(),
        isAspectRatioLocked: false,
        activeAspectRatio: '1:1', // Target 1:1 ratio
      });

      act(() => {
        result.current.toggleAspectRatioLock();
      });

      expect(result.current.isAspectRatioLocked).toBe(true);
      expect(result.current.parameters).toMatchObject({
        width: 1024,
        height: 1024,
      });
    });
  });

  describe('Aspect Ratio Setting', () => {
    it('should update active aspect ratio', () => {
      const { result } = renderHook(() => useImageStore());

      useImageStore.setState({
        parameters: createTestParameters(),
        parametersSchema: createTestSchema(),
      });

      act(() => {
        result.current.setAspectRatio('16:9');
      });

      expect(result.current.activeAspectRatio).toBe('16:9');
    });

    it('should calculate dimensions for width/height-based models', () => {
      const { result } = renderHook(() => useImageStore());

      useImageStore.setState({
        parameters: createTestParameters(),
        parametersSchema: createTestSchema(),
      });

      act(() => {
        result.current.setAspectRatio('16:9');
      });

      const params = result.current.parameters!;
      expect(params.width).toBeGreaterThan(params.height!);

      const ratio = params.width! / params.height!;
      expect(ratio).toBeCloseTo(16 / 9, 1);
    });

    it('should update aspectRatio parameter for models with native support', () => {
      const { result } = renderHook(() => useImageStore());

      useImageStore.setState({
        parameters: { aspectRatio: '1:1', prompt: '' },
        parametersSchema: createTestSchema({
          aspectRatio: { default: '1:1', enum: ['1:1', '16:9', '4:3'] },
        }),
      });

      act(() => {
        result.current.setAspectRatio('16:9');
      });

      expect(result.current.parameters?.aspectRatio).toBe('16:9');
      expect(result.current.activeAspectRatio).toBe('16:9');
    });

    it('should handle missing parameters or schema gracefully', () => {
      const { result } = renderHook(() => useImageStore());

      useImageStore.setState({
        parameters: undefined,
        parametersSchema: undefined,
      });

      expect(() => {
        act(() => {
          result.current.setAspectRatio('16:9');
        });
      }).not.toThrow();
    });
  });

  describe('Configuration Initialization', () => {
    beforeEach(() => {
      vi.doMock('@/store/global', () => ({
        useGlobalStore: {
          getState: () => ({
            status: {
              lastSelectedImageModel: 'flux/schnell',
              lastSelectedImageProvider: 'fal',
            },
          }),
        },
      }));

      vi.doMock('@/store/user', () => ({
        useUserStore: {
          getState: () => ({ user: { id: 'test' } }),
        },
      }));
    });

    it('should initialize with remembered model when user is logged in', () => {
      currentImageSettingsMock.mockReturnValueOnce({ defaultImageNum: 6 });
      const { result } = renderHook(() => useImageStore());

      useImageStore.setState({
        isInit: false,
        model: '',
        provider: '',
      });

      act(() => {
        result.current.initializeImageConfig('flux/schnell', 'fal');
      });

      expect(result.current.model).toBe('flux/schnell');
      expect(result.current.provider).toBe('fal');
      expect(result.current.parameters).toEqual({
        ...fluxSchnellDefaultValues,
        prompt: 'initial prompt',
      });
      expect(result.current.isInit).toBe(true);
      expect(result.current.imageNum).toBe(6);
    });

    it('should restore a valid remembered image count and size', () => {
      const { result } = renderHook(() => useImageStore());

      useImageStore.setState({
        isInit: false,
        model: '',
        provider: '',
      });

      act(() => {
        result.current.initializeImageConfig('size-model', 'custom-provider', 8, '1536x1024');
      });

      expect(result.current.imageNum).toBe(8);
      expect(result.current.parameters).toEqual({
        ...sizeCapableModelDefaultValues,
        prompt: 'initial prompt',
        size: '1536x1024',
      });
      expect(result.current.isInit).toBe(true);
    });

    it('should restore a valid remembered GPT Image 2 custom size', () => {
      const { result } = renderHook(() => useImageStore());

      useImageStore.setState({
        isInit: false,
        model: '',
        provider: '',
      });

      act(() => {
        result.current.initializeImageConfig(
          'gpt-image-2',
          'openaicompatible',
          8,
          '2048x2048',
        );
      });

      expect(result.current.imageNum).toBe(8);
      expect(result.current.parameters).toMatchObject({
        prompt: 'initial prompt',
        size: '2048x2048',
      });
    });

    it('should fall back to auto for an invalid remembered GPT Image 2 custom size', () => {
      const { result } = renderHook(() => useImageStore());

      useImageStore.setState({
        isInit: false,
        model: '',
        provider: '',
      });

      act(() => {
        result.current.initializeImageConfig(
          'gpt-image-2',
          'openaicompatible',
          8,
          '1025x1024',
        );
      });

      expect(result.current.imageNum).toBe(8);
      expect(result.current.parameters).toMatchObject({
        prompt: 'initial prompt',
        size: 'auto',
      });
    });

    it('should fall back to current defaults for invalid remembered count and size', () => {
      currentImageSettingsMock.mockReturnValueOnce({ defaultImageNum: 6 });
      const { result } = renderHook(() => useImageStore());

      useImageStore.setState({
        isInit: false,
        model: '',
        provider: '',
      });

      act(() => {
        result.current.initializeImageConfig('size-model', 'custom-provider', 0, 'invalid-size');
      });

      expect(result.current.imageNum).toBe(6);
      expect(result.current.parameters).toEqual({
        ...sizeCapableModelDefaultValues,
        prompt: 'initial prompt',
      });
      expect(result.current.isInit).toBe(true);
    });

    it('should initialize an enabled image model without remembered preferences', () => {
      const { result } = renderHook(() => useImageStore());

      useImageStore.setState({ isInit: false });

      act(() => {
        result.current.initializeImageConfig();
      });

      expect(result.current.isInit).toBe(true);
      expect(result.current.imageNum).toBe(4);
      expect(result.current.model).toBe('flux/schnell');
      expect(result.current.provider).toBe('fal');
    });

    it('should skip a schema-less model when a later enabled model is usable', () => {
      const { result } = renderHook(() => useImageStore());
      mockProviders[0].children = [
        {
          ...testImageModels[0],
          id: 'schema-less-model',
          parameters: undefined,
        },
        testImageModels[0],
      ];
      useImageStore.setState({ isInit: false });

      act(() => {
        result.current.initializeImageConfig();
      });

      expect(result.current.isImageModelAvailable).toBe(true);
      expect(result.current.isInit).toBe(true);
      expect(result.current.model).toBe('flux/schnell');
      expect(result.current.provider).toBe('fal');
    });

    it('should preserve a draft prompt typed before remembered preferences initialize', () => {
      const { result } = renderHook(() => useImageStore());

      useImageStore.setState({
        isInit: false,
        parameters: { ...initialTestState.parameters, prompt: 'draft prompt' },
      });

      act(() => {
        result.current.initializeImageConfig('size-model', 'custom-provider', 8, '1536x1024');
      });

      expect(result.current.parameters).toEqual({
        ...sizeCapableModelDefaultValues,
        prompt: 'draft prompt',
        size: '1536x1024',
      });
    });

    it('should retain a valid remembered image count when the saved model is unavailable', () => {
      const { result } = renderHook(() => useImageStore());

      useImageStore.setState({
        isInit: false,
        parameters: { ...initialTestState.parameters, prompt: 'draft prompt' },
      });

      act(() => {
        result.current.initializeImageConfig('removed-model', 'removed-provider', 8);
      });

      expect(result.current.isInit).toBe(true);
      expect(result.current.imageNum).toBe(8);
      expect(result.current.model).toBe('flux/schnell');
      expect(result.current.provider).toBe('fal');
      expect(result.current.parameters).toEqual({
        ...fluxSchnellDefaultValues,
        prompt: 'draft prompt',
      });
      expect(useGlobalStore.getState().status.lastSelectedImageNum).toBeUndefined();
    });

    it('should not apply a removed model size to the fallback model', () => {
      const { result } = renderHook(() => useImageStore());

      mockProviders[0].children = [testImageModels[2]];
      useImageStore.setState({
        isInit: false,
        parameters: { ...initialTestState.parameters, prompt: 'draft prompt' },
      });

      act(() => {
        result.current.initializeImageConfig('removed-model', 'removed-provider', 8, '1536x1024');
      });

      expect(result.current.imageNum).toBe(8);
      expect(result.current.model).toBe('size-model');
      expect(result.current.parameters).toEqual({
        ...sizeCapableModelDefaultValues,
        prompt: 'draft prompt',
      });
    });

    it('should settle as unavailable when no image models are enabled', () => {
      const { result } = renderHook(() => useImageStore());

      mockProviders[0].children = [];
      mockProviders[1].children = [];
      mockProviders[2].children = [];
      useImageStore.setState({ isInit: false });

      act(() => {
        result.current.initializeImageConfig();
      });

      expect(result.current.isInit).toBe(true);
      expect(result.current.isImageModelAvailable).toBe(false);
    });

    it('should handle initialization errors gracefully', () => {
      const { result } = renderHook(() => useImageStore());

      useImageStore.setState({ isInit: false });

      act(() => {
        result.current.initializeImageConfig('invalid-model', 'invalid-provider');
      });

      expect(result.current.isInit).toBe(true);
      expect(result.current.imageNum).toBe(4);
      expect(result.current.model).toBe('flux/schnell');
      expect(result.current.provider).toBe('fal');
    });

    it('should switch to an enabled model when the active selection is disabled', () => {
      const { result } = renderHook(() => useImageStore());

      useImageStore.setState({
        imageNum: 8,
        isImageModelAvailable: true,
        isInit: true,
        model: 'flux/schnell',
        parameters: { ...fluxSchnellDefaultValues, prompt: 'draft prompt' },
        provider: 'fal',
      });
      mockProviders[0].children = [];

      act(() => {
        result.current.revalidateImageConfig();
      });

      expect(result.current.isImageModelAvailable).toBe(true);
      expect(result.current.model).toBe('custom-model');
      expect(result.current.provider).toBe('custom-provider');
      expect(result.current.imageNum).toBe(8);
      expect(result.current.parameters).toEqual({
        ...customModelDefaultValues,
        prompt: 'draft prompt',
      });
    });

    it('should not overwrite guest preferences when falling back from an unavailable model', () => {
      const { result } = renderHook(() => useImageStore());
      useGlobalStore.setState({
        status: {
          ...INITIAL_STATUS,
          lastSelectedImageModel: 'size-model',
          lastSelectedImageNum: 8,
          lastSelectedImageProvider: 'custom-provider',
          lastSelectedImageSize: '1536x1024',
        },
      });
      useImageStore.setState({
        imageNum: 8,
        isImageModelAvailable: true,
        isInit: true,
        model: 'size-model',
        parameters: {
          ...sizeCapableModelDefaultValues,
          prompt: 'draft prompt',
          size: '1536x1024',
        },
        parametersSchema: sizeCapableModelSchema,
        provider: 'custom-provider',
      });
      mockProviders[1].children = [testImageModels[1]];

      act(() => {
        result.current.revalidateImageConfig('size-model', 'custom-provider', 8, '1536x1024');
      });

      expect(result.current.model).toBe('flux/schnell');
      expect(result.current.provider).toBe('fal');
      expect(useGlobalStore.getState().status).toMatchObject({
        lastSelectedImageModel: 'size-model',
        lastSelectedImageNum: 8,
        lastSelectedImageProvider: 'custom-provider',
        lastSelectedImageSize: '1536x1024',
      });
    });

    it('should not write an automatic fallback to signed-in preferences', () => {
      vi.mocked(authSelectors.isLogin).mockReturnValue(true);
      const { result } = renderHook(() => useImageStore());
      useImageStore.setState({
        imageNum: 8,
        isImageModelAvailable: true,
        isInit: true,
        model: 'size-model',
        parameters: {
          ...sizeCapableModelDefaultValues,
          prompt: 'draft prompt',
          size: '1536x1024',
        },
        parametersSchema: sizeCapableModelSchema,
        provider: 'custom-provider',
      });
      mockProviders[1].children = [testImageModels[1]];

      act(() => {
        result.current.revalidateImageConfig('size-model', 'custom-provider', 8, '1536x1024');
      });

      expect(result.current.model).toBe('flux/schnell');
      expect(result.current.provider).toBe('fal');
      expect(updateImageConfigMock).not.toHaveBeenCalled();
    });

    it('should preserve transient size-less model parameters when remembered size is null', () => {
      const { result } = renderHook(() => useImageStore());
      const transientParameters = {
        ...fluxSchnellDefaultValues,
        height: 896,
        prompt: 'draft prompt',
        width: 1152,
      };
      act(() => {
        useImageStore.setState({
          imageNum: 8,
          isImageModelAvailable: true,
          isInit: true,
          model: 'flux/schnell',
          parameters: transientParameters,
          parametersSchema: fluxSchnellParamsSchema,
          provider: 'fal',
        });
      });

      act(() => {
        result.current.revalidateImageConfig('flux/schnell', 'fal', 8, null);
      });

      expect(result.current.parameters).toEqual(transientParameters);
    });

    it('should restore a size-capable model default when remembered size is null', () => {
      const { result } = renderHook(() => useImageStore());
      useImageStore.setState({
        imageNum: 8,
        isImageModelAvailable: true,
        isInit: true,
        model: 'size-model',
        parameters: {
          ...sizeCapableModelDefaultValues,
          prompt: 'draft prompt',
          size: '1536x1024',
        },
        parametersSchema: sizeCapableModelSchema,
        provider: 'custom-provider',
      });

      act(() => {
        result.current.revalidateImageConfig('size-model', 'custom-provider', 8, null);
      });

      expect(result.current.parameters).toEqual({
        ...sizeCapableModelDefaultValues,
        prompt: 'draft prompt',
      });
    });

    it('should restore defaults when the preference owner changes to an empty scope', () => {
      const { result } = renderHook(() => useImageStore());
      useImageStore.setState({
        hasRememberedImageConfig: true,
        imageNum: 8,
        isImageModelAvailable: true,
        isInit: true,
        model: 'size-model',
        parameters: {
          ...sizeCapableModelDefaultValues,
          prompt: 'draft prompt',
          size: '1536x1024',
        },
        parametersSchema: sizeCapableModelSchema,
        preferenceOwner: 'user:first-user',
        provider: 'custom-provider',
      });

      act(() => {
        result.current.revalidateImageConfig(undefined, undefined, undefined, undefined, 'guest');
      });

      expect(result.current.hasRememberedImageConfig).toBe(false);
      expect(result.current.imageNum).toBe(4);
      expect(result.current.model).toBe('flux/schnell');
      expect(result.current.parameters).toEqual({
        ...fluxSchnellDefaultValues,
        prompt: 'draft prompt',
      });
      expect(result.current.preferenceOwner).toBe('guest');
      expect(result.current.provider).toBe('fal');
    });

    it('should preserve the draft when the same usable model restores availability', () => {
      const { result } = renderHook(() => useImageStore());
      useImageStore.setState({
        isImageModelAvailable: false,
        isInit: true,
        model: 'custom-model',
        parameters: {
          ...fluxSchnellDefaultValues,
          prompt: 'draft prompt',
        },
        provider: 'custom-provider',
      });

      act(() => {
        result.current.setModelAndProviderOnSelect('custom-model', 'custom-provider');
      });

      expect(result.current.isImageModelAvailable).toBe(true);
      expect(result.current.model).toBe('custom-model');
      expect(result.current.provider).toBe('custom-provider');
      expect(result.current.parameters).toEqual({
        ...customModelDefaultValues,
        prompt: 'draft prompt',
      });
    });

    it('should recover when image models become available after an empty state', () => {
      const { result } = renderHook(() => useImageStore());

      mockProviders[0].children = [];
      mockProviders[1].children = [];
      mockProviders[2].children = [];
      useImageStore.setState({
        isImageModelAvailable: false,
        isInit: true,
        parameters: { ...initialTestState.parameters, prompt: 'draft prompt' },
      });
      mockProviders[1].children = [testImageModels[2]];
      act(() => {
        result.current.revalidateImageConfig('size-model', 'custom-provider', 8, '1536x1024');
      });

      expect(result.current.isImageModelAvailable).toBe(true);
      expect(result.current.model).toBe('size-model');
      expect(result.current.provider).toBe('custom-provider');
      expect(result.current.imageNum).toBe(8);
      expect(result.current.parameters).toEqual({
        ...sizeCapableModelDefaultValues,
        prompt: 'draft prompt',
        size: '1536x1024',
      });
    });

    it('should use current defaults when no preferences exist after an empty state', () => {
      currentImageSettingsMock.mockReturnValue({ defaultImageNum: 8 });
      const { result } = renderHook(() => useImageStore());

      act(() => {
        mockProviders[0].children = [];
        mockProviders[1].children = [];
        mockProviders[2].children = [];
        useImageStore.setState({
          imageNum: 4,
          parameters: {
            ...initialTestState.parameters,
            prompt: 'draft prompt',
            size: '1536x1024',
          },
        });
      });

      act(() => {
        result.current.initializeImageConfig();
      });

      expect(result.current.imageNum).toBe(8);
      expect(result.current.isImageModelAvailable).toBe(false);

      mockProviders[1].children = [testImageModels[2]];
      act(() => {
        result.current.revalidateImageConfig();
      });

      expect(result.current.isImageModelAvailable).toBe(true);
      expect(result.current.imageNum).toBe(8);
      expect(result.current.parameters).toEqual({
        ...sizeCapableModelDefaultValues,
        prompt: 'draft prompt',
      });
    });

    it('should prefer the remembered model over stale current state during recovery', () => {
      const { result } = renderHook(() => useImageStore());
      useImageStore.setState({
        isImageModelAvailable: false,
        isInit: true,
        model: 'flux/schnell',
        parameters: { ...fluxSchnellDefaultValues, prompt: 'draft prompt' },
        parametersSchema: fluxSchnellParamsSchema,
        provider: 'fal',
      });
      act(() => {
        result.current.revalidateImageConfig('size-model', 'custom-provider', 8, '1536x1024');
      });

      expect(result.current.isImageModelAvailable).toBe(true);
      expect(result.current.imageNum).toBe(8);
      expect(result.current.model).toBe('size-model');
      expect(result.current.provider).toBe('custom-provider');
      expect(result.current.parameters).toEqual({
        ...sizeCapableModelDefaultValues,
        prompt: 'draft prompt',
        size: '1536x1024',
      });
    });

    it('should refresh parameters when an enabled model schema changes', () => {
      const { result } = renderHook(() => useImageStore());
      const refreshedSizeSchema: ModelParamsSchema = {
        prompt: { default: '' },
        size: { default: '1024x1024', enum: ['1024x1024'] },
      };

      useImageStore.setState({
        imageNum: 8,
        isImageModelAvailable: true,
        isInit: true,
        model: 'size-model',
        parameters: {
          ...sizeCapableModelDefaultValues,
          prompt: 'draft prompt',
          size: '1536x1024',
        },
        parametersSchema: sizeCapableModelSchema,
        provider: 'custom-provider',
      });
      act(() => {
        mockProviders[1].children = [
          testImageModels[1],
          { ...testImageModels[2], parameters: refreshedSizeSchema },
        ];
      });

      act(() => {
        result.current.revalidateImageConfig('size-model', 'custom-provider', 8, '1536x1024');
      });

      expect(result.current.isImageModelAvailable).toBe(true);
      expect(result.current.parametersSchema).toEqual(refreshedSizeSchema);
      expect(result.current.parameters).toEqual({
        prompt: 'draft prompt',
        size: '1024x1024',
      });
      expect(useGlobalStore.getState().status.lastSelectedImageSize).toBe('1024x1024');
    });
  });
});
