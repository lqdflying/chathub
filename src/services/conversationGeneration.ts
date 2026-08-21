import type {
  ConversationGenerationDeferred,
  ConversationGenerationEnqueueInput,
  ConversationGenerationEvent,
  ConversationGenerationOperation,
  ConversationGenerationStreamEvent,
} from '@lobechat/types';
import { isActiveConversationGenerationStatus, isConversationGenerationDeferred as isDeferredResult } from '@lobechat/types';
import { TRPCClientError } from '@trpc/client';

import { CHATHUB_ACCOUNT_SCOPE_HEADER } from '@/const/auth';
import { logGenerationDebugClientSafe } from '@/libs/logger/generationDebugClient';
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

  listActive = async (options?: { quiet?: boolean }) => {
    return lambdaClient.conversationGeneration.listActive.query(undefined, {
      context: { showNotification: !options?.quiet },
    });
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

export type { ConversationGenerationDeferred } from '@lobechat/types';

export type ConversationGenerationEnqueueResult =
  ConversationGenerationOperation | ConversationGenerationDeferred;

export const isConversationGenerationDeferred = (
  value: ConversationGenerationEnqueueResult | undefined,
): value is ConversationGenerationDeferred => isDeferredResult(value);

export const asConversationGenerationOperation = (
  value: ConversationGenerationEnqueueResult | undefined,
): ConversationGenerationOperation | undefined =>
  isConversationGenerationDeferred(value) ? undefined : value;

const DURABLE_DEFERRAL_MESSAGE_PREFIX = 'Durable generation deferred to the browser';

const extractDeferredToolName = (message: string) => {
  const match = message.match(/Durable generation deferred to the browser for "([^"]+)"/);
  return match?.[1];
};

export const describeConversationGenerationDeferral = (
  error: unknown,
): ConversationGenerationDeferred | undefined => {
  const message = error instanceof Error ? error.message : String(error);
  const trpcCode =
    error instanceof TRPCClientError
      ? (error.data as { code?: string } | undefined)?.code
      : undefined;

  if (message.includes(DURABLE_DEFERRAL_MESSAGE_PREFIX)) {
    return {
      deferred: true,
      reason: 'unsupported_tool',
      toolName: extractDeferredToolName(message),
    };
  }

  if (
    trpcCode === 'PRECONDITION_FAILED' ||
    message.includes('Durable background generation requires a provider API key') ||
    message.includes('No server-reachable credentials were found')
  ) {
    return { deferred: true, reason: 'fetch_on_client' };
  }

  return undefined;
};

const isNonRecoverableEnqueueError = (error: unknown) => {
  if (error instanceof TRPCClientError) {
    const code = (error.data as { code?: string } | undefined)?.code;
    if (
      code === 'CONFLICT' ||
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
): Promise<ConversationGenerationEnqueueResult | undefined> => {
  try {
    const operation = (await conversationGenerationService.enqueue(
      input,
    )) as ConversationGenerationOperation;
    logGenerationDebugClientSafe('enqueue_client_settled', {
      kind: input.kind,
      outcome: 'ok',
      spanId: input.debugSpanId,
      status: operation?.status,
    });
    return operation;
  } catch (error) {
    const errorClass = error instanceof Error ? error.name : typeof error;
    const trpcCode =
      error instanceof TRPCClientError
        ? (error.data as { code?: string } | undefined)?.code
        : undefined;
    const deferral = describeConversationGenerationDeferral(error);
    if (deferral) {
      logGenerationDebugClientSafe('enqueue_client_settled', {
        errorClass,
        kind: input.kind,
        outcome: 'deferred',
        reason: deferral.reason,
        spanId: input.debugSpanId,
        toolName: deferral.toolName,
        trpcCode,
      });
      return deferral;
    }
    if (isNonRecoverableEnqueueError(error)) {
      logGenerationDebugClientSafe('enqueue_client_settled', {
        errorClass,
        kind: input.kind,
        outcome: 'nonRecoverable',
        spanId: input.debugSpanId,
        trpcCode,
      });
      return undefined;
    }
    const recovered = await recoverByIdempotencyKey(input);
    logGenerationDebugClientSafe('enqueue_client_settled', {
      errorClass,
      kind: input.kind,
      outcome: recovered ? 'recoveredByKey' : 'lost',
      recovered: Boolean(recovered),
      spanId: input.debugSpanId,
      trpcCode,
    });
    return recovered;
  }
};

export const waitForConversationGeneration = async (
  operationId: string,
  options?: { intervalMs?: number; signal?: AbortSignal; timeoutMs?: number },
) => {
  const intervalMs = options?.intervalMs ?? 400;
  const timeoutMs = options?.timeoutMs ?? 15 * 60 * 1000;
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    if (options?.signal?.aborted) return;
    try {
      const operation = await conversationGenerationService.getOperation(operationId);
      if (!operation || !isActiveConversationGenerationStatus(operation.status)) {
        return operation;
      }
    } catch {
      // Keep waiting through transient poll errors.
    }
    await new Promise((resolve) => {
      setTimeout(resolve, intervalMs);
    });
  }

  try {
    return await conversationGenerationService.getOperation(operationId);
  } catch {
    return;
  }
};
