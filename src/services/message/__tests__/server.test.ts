import { describe, expect, it, vi } from 'vitest';

import { INBOX_SESSION_ID } from '@/const/session';
import { lambdaClient } from '@/libs/trpc/client';
import { TOOLS_DIAGNOSTIC_CONTEXT_KEY } from '@/libs/trpc/client/tools';

import { ServerService } from '../server';

vi.mock('@/libs/trpc/client', () => ({
  lambdaClient: {
    message: {
      getMessageById: { query: vi.fn() },
    },
  },
}));

describe('ServerService', () => {
  describe('getMessageById', () => {
    it('queries the isolated diagnostic link with notifications suppressed (finalization read)', async () => {
      const persisted = { content: 'final content', groupId: 'group-1', tools: [{ id: 'c1' }] };
      vi.mocked(lambdaClient.message.getMessageById.query).mockResolvedValue(persisted as any);
      const service = new ServerService();

      const result = await service.getMessageById('msg-1', {
        diagnosticId: 'td_1234567890abcdef',
        diagnosticOperation: 'finalize_assistant_message',
        showNotification: false,
      });

      // the read must not trigger the global 401-login/fetch-error UI, and the
      // diagnostic context keeps it off the shared batch link
      expect(lambdaClient.message.getMessageById.query).toHaveBeenCalledWith(
        { id: 'msg-1' },
        {
          context: {
            [TOOLS_DIAGNOSTIC_CONTEXT_KEY]: 'td_1234567890abcdef',
            diagnosticOperation: 'finalize_assistant_message',
            showNotification: false,
          },
        },
      );
      expect(result).toEqual(persisted);
    });

    it('passes no context when called without options', async () => {
      vi.mocked(lambdaClient.message.getMessageById.query).mockResolvedValue(undefined as any);
      const service = new ServerService();

      await service.getMessageById('msg-2');

      expect(lambdaClient.message.getMessageById.query).toHaveBeenLastCalledWith(
        { id: 'msg-2' },
        undefined,
      );
    });
  });

  describe('toDbSessionId', () => {
    const service = new ServerService();
    // @ts-ignore access private method for testing
    const toDbSessionId = service.toDbSessionId;

    it('should return null for INBOX_SESSION_ID', () => {
      expect(toDbSessionId(INBOX_SESSION_ID)).toBeNull();
    });

    it('should return the same session id for non-inbox sessions', () => {
      const sessionId = 'test-session-123';
      expect(toDbSessionId(sessionId)).toBe(sessionId);
    });

    it('should handle undefined input', () => {
      expect(toDbSessionId(undefined)).toBeUndefined(); // Updated to match the actual behavior
    });

    it('should handle empty string input', () => {
      expect(toDbSessionId('')).toBe(''); // No changes needed
    });

    it('should handle special characters in session id', () => {
      const specialSessionId = '!@#$%^&*()_+';
      expect(toDbSessionId(specialSessionId)).toBe(specialSessionId);
    });

    it('should handle numeric session id', () => {
      const numericSessionId = '12345';
      expect(toDbSessionId(numericSessionId)).toBe(numericSessionId);
    });

    it('should handle null session id', () => {
      expect(toDbSessionId(null as any)).toBeNull(); // Cast null to any to bypass type errors
    });
  });
});
