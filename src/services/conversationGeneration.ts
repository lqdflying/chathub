import type {
  ConversationGenerationEnqueueInput,
  ConversationGenerationEvent,
  ConversationGenerationOperation,
  ConversationGenerationStreamEvent,
} from '@lobechat/types';
import { TRPCClientError } from '@trpc/client';

import { CHATHUB_ACCOUNT_SCOPE_HEADER } from '@/const/auth';
import { lambdaClient } from '@/libs/trpc/client';
import { createHeaderWithAuth } from '@/services/_auth';
import { captureAccountMutationSnapshot } from '@/store/accountMutation';
import { useUserStore } from '@/store/user';

const parseSseBlocks = (chunk: string) => {
  const events: Array<{ data?: string; event?: string; id?: string }> = [];
  for (const block of chunk.split('\n\n')) {
    if (!block.trim() || block.startsWith(':')) continue;
    const parsed: { data?: string; event?: string; id?: string } = {};
    for (const line of block.split('\n')) {
      if (line.startsWith('id:')) parsed.id = line.slice(3).trim();
      else if (line.startsWith('event:')) parsed.event = line.slice(6).trim();
      else if (line.startsWith('data:')) {
        parsed.data = `${parsed.data ?? ''}${line.slice(5).trim()}`;
      }
    }
    if (parsed.event || parsed.data) events.push(parsed);
  }
  return events;
};

class ConversationGenerationClient {
  enqueue = async (input: ConversationGenerationEnqueueInput) => {
    return lambdaClient.conversationGeneration.enqueue.mutate(input, {
      context: { showNotification: false },
    });
  };

  cancel = async (operationId: string) => {
    return lambdaClient.conversationGeneration.cancel.mutate(
      { operationId },
      { context: { showNotification: false } },
    );
  };

  getOperation = async (operationId: string) => {
    return lambdaClient.conversationGeneration.getOperation.query({ operationId });
  };

  getOperationByIdempotencyKey = async (idempotencyKey: string) => {
    return lambdaClient.conversationGeneration.getOperationByIdempotencyKey.query({
      idempotencyKey,
    });
  };

  listActive = async () => {
    return lambdaClient.conversationGeneration.listActive.query();
  };

  listEvents = async (cursor = 0) => {
    return lambdaClient.conversationGeneration.listEvents.query({ cursor });
  };

  subscribe = async ({
    cursor = 0,
    onEvent,
    signal,
  }: {
    cursor?: number;
    onEvent: (event: ConversationGenerationStreamEvent) => void;
    signal?: AbortSignal;
  }) => {
    const headers = new Headers(await createHeaderWithAuth());
    const snapshot = captureAccountMutationSnapshot(useUserStore.getState());
    if (snapshot) headers.set(CHATHUB_ACCOUNT_SCOPE_HEADER, snapshot.scope);
    if (cursor > 0) headers.set('Last-Event-ID', String(cursor));

    const response = await fetch('/webapi/conversation-generation/stream', {
      headers,
      method: 'GET',
      signal,
    });
    if (!response.ok || !response.body) {
      throw new Error(`Conversation generation stream failed (${response.status})`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    const deliver = (complete: string) => {
      for (const ev of parseSseBlocks(complete)) {
        if (!ev.data) continue;
        try {
          const data = JSON.parse(ev.data);
          if (ev.event === 'reset' || data?.reset) {
            onEvent({ reset: true, type: 'reset' });
            continue;
          }
          onEvent(data as ConversationGenerationEvent);
        } catch {
          // ignore malformed frames
        }
      }
    };
    try {
      // eslint-disable-next-line no-constant-condition
      while (true) {
        if (signal?.aborted) break;
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lastBreak = buffer.lastIndexOf('\n\n');
        if (lastBreak < 0) continue;
        const complete = buffer.slice(0, lastBreak + 2);
        buffer = buffer.slice(lastBreak + 2);
        deliver(complete);
      }
      buffer += decoder.decode();
      if (buffer.trim()) deliver(buffer);
    } finally {
      reader.releaseLock();
    }
  };
}

export const conversationGenerationService = new ConversationGenerationClient();

const isNonRecoverableEnqueueError = (error: unknown) => {
  if (error instanceof TRPCClientError) {
    const code = (error.data as { code?: string } | undefined)?.code;
    if (
      code === 'PRECONDITION_FAILED' ||
      code === 'UNPROCESSABLE_CONTENT' ||
      code === 'FORBIDDEN' ||
      code === 'UNAUTHORIZED'
    ) {
      return true;
    }
  }
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.includes('Durable background generation requires a provider API key') ||
    message.includes('No server-reachable credentials were found') ||
    message.includes('Durable generation deferred to the browser') ||
    message.includes('Durable conversation generation is disabled')
  );
};

const recoverByIdempotencyKey = async (input: ConversationGenerationEnqueueInput) => {
  if (!input.idempotencyKey) return;
  try {
    return (await conversationGenerationService.getOperationByIdempotencyKey(
      input.idempotencyKey,
    )) as ConversationGenerationOperation | undefined;
  } catch {
    return;
  }
};

export const tryEnqueueConversationGeneration = async (
  input: ConversationGenerationEnqueueInput,
): Promise<ConversationGenerationOperation | undefined> => {
  try {
    return (await conversationGenerationService.enqueue(input)) as ConversationGenerationOperation;
  } catch (error) {
    if (isNonRecoverableEnqueueError(error)) return undefined;
    return recoverByIdempotencyKey(input);
  }
};
