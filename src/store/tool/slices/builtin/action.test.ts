import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { useToolStore } from '../../store';

vi.mock('zustand/traditional');

describe('createBuiltinToolSlice', () => {
  describe('invokeBuiltinTool', () => {
    it('should return if the tool is already loading', async () => {
      // Given
      const key = 'text2image';
      const params = {};

      const mockFn = vi.fn();
      const { result } = renderHook(() => useToolStore());

      act(() => {
        useToolStore.setState({
          text2image: mockFn,
        });
      });

      await act(async () => {
        // When
        const data = await result.current.transformApiArgumentsToAiState(key, params);
        expect(data).toBeUndefined();
      });

      // Then
      expect(mockFn).toHaveBeenCalled();
    });

    it('should invoke the specified tool action and return the stringified result', async () => {
      // Given
      const key = 'text2image';

      const mockFn = vi.fn();
      const { result } = renderHook(() => useToolStore());

      const params = {
        prompts: ['test prompt'],
        size: '512x512',
        quality: 'standard',
        style: 'vivid',
      };

      act(() => {
        useToolStore.setState({
          builtinToolLoading: { [key]: false },
          text2image: mockFn,
        });
      });
      // When
      await act(async () => {
        await result.current.transformApiArgumentsToAiState(key, params);
      });

      expect(mockFn).toBeCalledWith({
        prompts: ['test prompt'],
        quality: 'standard',
        size: '512x512',
        style: 'vivid',
      });
    });
  });

  describe('text2image', () => {
    it('should map the prompts to prompt-only DallEImageItem objects', () => {
      // When
      const { result } = renderHook(() => useToolStore());

      // size/quality/style now come from the configured image model, not the tool
      const data = result.current.text2image({ prompts: ['prompt1', 'prompt2'] });

      // Then
      expect(data).toEqual([{ prompt: 'prompt1' }, { prompt: 'prompt2' }]);
    });
  });
});
