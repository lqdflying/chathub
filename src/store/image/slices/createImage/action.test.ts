import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { imageService } from '@/services/image';
import { useImageStore } from '@/store/image';
import { useUserStore } from '@/store/user';

// Mock external dependencies
vi.mock('@/services/image', () => ({
  imageService: {
    createImage: vi.fn().mockResolvedValue({
      success: true,
      data: {
        batch: {
          generationTopicId: 'test-topic-id',
          provider: 'test-provider',
          model: 'test-model',
          prompt: 'test prompt',
          width: 1024,
          height: 1024,
          userId: 'test-user',
          id: 'batch-id',
          accessedAt: new Date(),
          createdAt: new Date(),
          updatedAt: new Date(),
          ratio: null,
          config: {},
        },
        generations: [],
      },
    }),
  },
}));

const mockImageService = vi.mocked(imageService);

describe('CreateImageAction', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset to initial state with proper defaults
    const initialState = useImageStore.getState();
    useImageStore.setState({
      ...initialState,
      isCreating: false,
      isCreatingWithNewTopic: false,
      isImageModelAvailable: true,
      isInit: true,
      activeGenerationTopicId: 'active-topic-id',
      parameters: { prompt: 'test prompt', width: 1024, height: 1024 },
      provider: 'test-provider',
      model: 'test-model',
      imageNum: 4,
      generationBatchesMap: {
        'active-topic-id': [
          {
            id: 'batch-id',
            provider: 'batch-provider',
            model: 'batch-model',
            config: { prompt: 'batch prompt' },
            generations: [{}, {}, {}, {}], // 4 generations to match expected imageNum
            createdAt: new Date(),
            prompt: 'batch prompt',
          } as any,
        ],
      },
    });
    useUserStore.setState({
      userStateInitializationFailure: undefined,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('createImage', () => {
    it('rejects creation while the active account has an ownership failure', async () => {
      const { result } = renderHook(() => useImageStore());
      useUserStore.setState({
        userStateInitializationFailure: {
          reason: 'owner-mismatch',
          scope: 'local',
        },
      });

      await expect(
        act(async () => {
          await result.current.createImage();
        }),
      ).rejects.toThrow('user state ownership is not initialized');

      expect(mockImageService.createImage).not.toHaveBeenCalled();
      expect(useImageStore.getState().isCreating).toBe(false);
    });

    it('should reject creation until image configuration is initialized', async () => {
      const { result } = renderHook(() => useImageStore());

      act(() => {
        useImageStore.setState({ isInit: false });
      });

      await expect(
        act(async () => {
          await result.current.createImage();
        }),
      ).rejects.toThrow('image configuration is not initialized');

      expect(mockImageService.createImage).not.toHaveBeenCalled();
      expect(useImageStore.getState().isCreating).toBe(false);
    });

    it('should reject creation when no image model is available', async () => {
      const { result } = renderHook(() => useImageStore());

      act(() => {
        useImageStore.setState({ isImageModelAvailable: false, isInit: true });
      });

      await expect(
        act(async () => {
          await result.current.createImage();
        }),
      ).rejects.toThrow('image configuration is not initialized');

      expect(mockImageService.createImage).not.toHaveBeenCalled();
      expect(useImageStore.getState().isCreating).toBe(false);
    });

    it('should create image with existing topic', async () => {
      const { result } = renderHook(() => useImageStore());
      const mockRefreshGenerationBatches = vi.fn().mockResolvedValue(undefined);

      // Set up store state
      act(() => {
        useImageStore.setState({
          refreshGenerationBatches: mockRefreshGenerationBatches,
        });
      });

      await act(async () => {
        await result.current.createImage();
      });

      // Verify state changes
      expect(useImageStore.getState().isCreating).toBe(false);
      expect(useImageStore.getState().isCreatingWithNewTopic).toBe(false);

      // Verify service calls
      expect(mockImageService.createImage).toHaveBeenCalledWith({
        generationTopicId: 'active-topic-id',
        provider: 'test-provider',
        model: 'test-model',
        imageNum: 4,
        params: { prompt: 'test prompt', width: 1024, height: 1024 },
      });

      // Verify refresh was called
      expect(mockRefreshGenerationBatches).toHaveBeenCalled();

      // Verify prompt is cleared after successful image creation
      expect(result.current.parameters?.prompt).toBe('');
    });

    it('should create new topic when no active topic exists', async () => {
      const mockCreateGenerationTopic = vi.fn().mockResolvedValue('new-topic-id');
      const mockSwitchGenerationTopic = vi.fn();
      const mockSetTopicBatchLoaded = vi.fn();

      const { result } = renderHook(() => useImageStore());

      act(() => {
        useImageStore.setState({
          activeGenerationTopicId: '', // No active topic
          createGenerationTopic: mockCreateGenerationTopic,
          switchGenerationTopic: mockSwitchGenerationTopic,
          setTopicBatchLoaded: mockSetTopicBatchLoaded,
        });
      });

      await act(async () => {
        await result.current.createImage();
      });

      // Verify state changes
      expect(useImageStore.getState().isCreating).toBe(false);
      expect(useImageStore.getState().isCreatingWithNewTopic).toBe(false);

      // Verify topic creation
      expect(mockCreateGenerationTopic).toHaveBeenCalledWith(['test prompt']);
      expect(mockSetTopicBatchLoaded).toHaveBeenCalledWith('new-topic-id');
      expect(mockSwitchGenerationTopic).toHaveBeenCalledWith('new-topic-id');

      // Verify service call with new topic id
      expect(mockImageService.createImage).toHaveBeenCalledWith({
        generationTopicId: 'new-topic-id',
        provider: 'test-provider',
        model: 'test-model',
        imageNum: 4,
        params: { prompt: 'test prompt', width: 1024, height: 1024 },
      });

      // Verify prompt is cleared after successful image creation
      expect(result.current.parameters?.prompt).toBe('');
    });

    it('should throw error when parameters is not initialized', async () => {
      const { result } = renderHook(() => useImageStore());

      act(() => {
        useImageStore.setState({
          parameters: undefined, // Set parameters to undefined
        });
      });

      await expect(
        act(async () => {
          await result.current.createImage();
        }),
      ).rejects.toThrow('parameters is not initialized');

      expect(useImageStore.getState().isCreating).toBe(false);
      expect(useImageStore.getState().isCreatingWithNewTopic).toBe(false);
    });

    it('should throw error when prompt is empty', async () => {
      const { result } = renderHook(() => useImageStore());

      act(() => {
        useImageStore.setState({
          parameters: {
            prompt: '', // Empty prompt
            width: 1024,
            height: 1024,
          },
        });
      });

      await expect(
        act(async () => {
          await result.current.createImage();
        }),
      ).rejects.toThrow('prompt is empty');

      expect(useImageStore.getState().isCreating).toBe(false);
      expect(useImageStore.getState().isCreatingWithNewTopic).toBe(false);
      expect(mockImageService.createImage).not.toHaveBeenCalled();
    });

    it('should trim the prompt before creating an image', async () => {
      const mockRefreshGenerationBatches = vi.fn().mockResolvedValue(undefined);
      const { result } = renderHook(() => useImageStore());

      act(() => {
        useImageStore.setState({
          parameters: { prompt: '  test prompt  ', width: 1024, height: 1024 },
          refreshGenerationBatches: mockRefreshGenerationBatches,
        });
      });

      await act(async () => {
        await result.current.createImage();
      });

      expect(mockImageService.createImage).toHaveBeenCalledWith(
        expect.objectContaining({
          params: { prompt: 'test prompt', width: 1024, height: 1024 },
        }),
      );
    });

    it('should reject a whitespace-only prompt without entering a busy state', async () => {
      const { result } = renderHook(() => useImageStore());

      act(() => {
        useImageStore.setState({
          parameters: { prompt: '   ', width: 1024, height: 1024 },
        });
      });

      await expect(
        act(async () => {
          await result.current.createImage();
        }),
      ).rejects.toThrow('prompt is empty');

      expect(useImageStore.getState().isCreating).toBe(false);
      expect(useImageStore.getState().isCreatingWithNewTopic).toBe(false);
      expect(mockImageService.createImage).not.toHaveBeenCalled();
    });

    it('should reset busy states when topic creation fails', async () => {
      const mockCreateGenerationTopic = vi.fn().mockRejectedValue(new Error('Topic error'));
      const { result } = renderHook(() => useImageStore());

      act(() => {
        useImageStore.setState({
          activeGenerationTopicId: '',
          createGenerationTopic: mockCreateGenerationTopic,
        });
      });

      await expect(
        act(async () => {
          await result.current.createImage();
        }),
      ).rejects.toThrow('Topic error');

      expect(useImageStore.getState().isCreating).toBe(false);
      expect(useImageStore.getState().isCreatingWithNewTopic).toBe(false);
      expect(mockImageService.createImage).not.toHaveBeenCalled();
    });

    it('should handle service error', async () => {
      const error = new Error('Service error');
      mockImageService.createImage.mockRejectedValueOnce(error);

      const mockRefreshGenerationBatches = vi.fn();
      const { result } = renderHook(() => useImageStore());

      act(() => {
        useImageStore.setState({
          refreshGenerationBatches: mockRefreshGenerationBatches,
        });
      });

      await expect(
        act(async () => {
          await result.current.createImage();
        }),
      ).rejects.toThrow('Service error');

      // The service should have been called before the error
      expect(mockImageService.createImage).toHaveBeenCalled();

      // Verify prompt is NOT cleared when error occurs
      expect(result.current.parameters?.prompt).toBe('test prompt');
      expect(useImageStore.getState().isCreating).toBe(false);
      expect(useImageStore.getState().isCreatingWithNewTopic).toBe(false);
    });

    it('should handle service error with new topic', async () => {
      const error = new Error('Service error');
      mockImageService.createImage.mockRejectedValueOnce(error);

      const mockCreateGenerationTopic = vi.fn().mockResolvedValue('new-topic-id');
      const mockSwitchGenerationTopic = vi.fn();
      const mockSetTopicBatchLoaded = vi.fn();

      const { result } = renderHook(() => useImageStore());

      act(() => {
        useImageStore.setState({
          activeGenerationTopicId: '', // No active topic
          createGenerationTopic: mockCreateGenerationTopic,
          switchGenerationTopic: mockSwitchGenerationTopic,
          setTopicBatchLoaded: mockSetTopicBatchLoaded,
        });
      });

      let thrownError: unknown;
      await act(async () => {
        try {
          await result.current.createImage();
        } catch (error) {
          thrownError = error;
        }
      });

      // Verify topic was created before the error
      expect(thrownError).toEqual(error);
      expect(mockCreateGenerationTopic).toHaveBeenCalled();
      expect(mockSwitchGenerationTopic).toHaveBeenCalled();

      // Verify prompt is NOT cleared when error occurs
      expect(result.current.parameters?.prompt).toBe('test prompt');
      expect(useImageStore.getState().isCreating).toBe(false);
      expect(useImageStore.getState().isCreatingWithNewTopic).toBe(false);
    });

    it('should clear prompt input after successful image creation', async () => {
      const mockRefreshGenerationBatches = vi.fn().mockResolvedValue(undefined);
      const { result } = renderHook(() => useImageStore());

      // Set initial prompt value
      act(() => {
        useImageStore.setState({
          parameters: { prompt: 'detailed landscape artwork', width: 1024, height: 1024 },
          refreshGenerationBatches: mockRefreshGenerationBatches,
        });
      });

      // Verify initial prompt is set
      expect(result.current.parameters?.prompt).toBe('detailed landscape artwork');

      // Create image
      await act(async () => {
        await result.current.createImage();
      });

      // Verify prompt is cleared
      expect(result.current.parameters?.prompt).toBe('');

      // Verify other parameters remain unchanged
      expect(result.current.parameters?.width).toBe(1024);
      expect(result.current.parameters?.height).toBe(1024);
    });
  });

  describe('recreateImage', () => {
    it('rejects recreation while the active account has an ownership failure', async () => {
      const mockRemoveGenerationBatch = vi.fn();
      const { result } = renderHook(() => useImageStore());
      useImageStore.setState({ removeGenerationBatch: mockRemoveGenerationBatch });
      useUserStore.setState({
        userStateInitializationFailure: {
          reason: 'owner-mismatch',
          scope: 'local',
        },
      });

      await expect(
        act(async () => {
          await result.current.recreateImage('batch-id');
        }),
      ).rejects.toThrow('user state ownership is not initialized');

      expect(mockImageService.createImage).not.toHaveBeenCalled();
      expect(mockRemoveGenerationBatch).not.toHaveBeenCalled();
      expect(useImageStore.getState().isCreating).toBe(false);
    });

    it('should recreate image successfully', async () => {
      const mockRefreshGenerationBatches = vi.fn().mockResolvedValue(undefined);
      const mockRemoveGenerationBatch = vi.fn().mockResolvedValue(undefined);

      const { result } = renderHook(() => useImageStore());

      act(() => {
        useImageStore.setState({
          refreshGenerationBatches: mockRefreshGenerationBatches,
          removeGenerationBatch: mockRemoveGenerationBatch,
        });
      });

      // Get batch to verify imageNum uses batch.generations.length
      const batch = result.current.generationBatchesMap['active-topic-id']?.[0];
      const expectedImageNum = batch?.generations.length ?? 0;

      await act(async () => {
        await result.current.recreateImage('batch-id');
      });

      // Verify state changes
      expect(useImageStore.getState().isCreating).toBe(false);

      // Verify batch removal
      expect(mockRemoveGenerationBatch).toHaveBeenCalledWith('batch-id', 'active-topic-id');

      // Verify service call uses batch.generations.length for imageNum
      expect(mockImageService.createImage).toHaveBeenCalledWith({
        generationTopicId: 'active-topic-id',
        provider: 'batch-provider',
        model: 'batch-model',
        imageNum: expectedImageNum,
        params: { prompt: 'batch prompt' },
      });

      // Verify refresh was called
      expect(mockRefreshGenerationBatches).toHaveBeenCalled();
      expect(mockImageService.createImage.mock.invocationCallOrder[0]).toBeLessThan(
        mockRemoveGenerationBatch.mock.invocationCallOrder[0],
      );
    });

    it('should throw error when no active topic', async () => {
      const { result } = renderHook(() => useImageStore());

      act(() => {
        useImageStore.setState({
          activeGenerationTopicId: '', // No active topic
        });
      });

      await expect(
        act(async () => {
          await result.current.recreateImage('batch-id');
        }),
      ).rejects.toThrow('No active generation topic');

      expect(useImageStore.getState().isCreating).toBe(false);
      expect(mockImageService.createImage).not.toHaveBeenCalled();
    });

    it('should throw error when the generation batch does not exist', async () => {
      const { result } = renderHook(() => useImageStore());

      await expect(
        act(async () => {
          await result.current.recreateImage('missing-batch');
        }),
      ).rejects.toThrow('Generation batch not found');

      expect(useImageStore.getState().isCreating).toBe(false);
      expect(mockImageService.createImage).not.toHaveBeenCalled();
    });

    it('should handle service error', async () => {
      const error = new Error('Service error');
      mockImageService.createImage.mockRejectedValueOnce(error);

      const mockRefreshGenerationBatches = vi.fn().mockResolvedValue(undefined);
      const mockRemoveGenerationBatch = vi.fn().mockResolvedValue(undefined);

      const { result } = renderHook(() => useImageStore());

      act(() => {
        useImageStore.setState({
          refreshGenerationBatches: mockRefreshGenerationBatches,
          removeGenerationBatch: mockRemoveGenerationBatch,
        });
      });

      let thrownError: unknown;
      await act(async () => {
        try {
          await result.current.recreateImage('batch-id');
        } catch (caughtError) {
          thrownError = caughtError;
        }
      });

      // The failed batch is preserved if its replacement cannot be submitted.
      expect(thrownError).toEqual(error);
      expect(mockRemoveGenerationBatch).not.toHaveBeenCalled();
      expect(mockRefreshGenerationBatches).toHaveBeenCalled();
      expect(useImageStore.getState().isCreating).toBe(false);
    });

    it('should handle batch removal error', async () => {
      const error = new Error('Removal error');
      const mockRemoveGenerationBatch = vi.fn().mockRejectedValueOnce(error);
      const mockRefreshGenerationBatches = vi.fn().mockResolvedValue(undefined);

      const { result } = renderHook(() => useImageStore());

      act(() => {
        useImageStore.setState({
          refreshGenerationBatches: mockRefreshGenerationBatches,
          removeGenerationBatch: mockRemoveGenerationBatch,
        });
      });

      let thrownError: unknown;
      await act(async () => {
        try {
          await result.current.recreateImage('batch-id');
        } catch (caughtError) {
          thrownError = caughtError;
        }
      });

      // The replacement is accepted before the original batch is removed.
      expect(thrownError).toEqual(error);
      expect(mockImageService.createImage).toHaveBeenCalled();
      expect(mockImageService.createImage.mock.invocationCallOrder[0]).toBeLessThan(
        mockRemoveGenerationBatch.mock.invocationCallOrder[0],
      );
      expect(mockRefreshGenerationBatches).toHaveBeenCalled();
      expect(useImageStore.getState().isCreating).toBe(false);
    });
  });
});
