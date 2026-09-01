import { parseToolCalls } from '@lobechat/model-runtime';
import type { MessageToolCall, ModelReasoning, ModelUsage } from '@lobechat/types';

export {
  createEmptyCompletionAtContextCeilingError,
  isEmptyCompletionAtContextCeiling,
} from '@/helpers/emptyCompletionAtContextCeiling';

export interface ProtocolStreamResult {
  content: string;
  error?: { body?: unknown; message: string; type: string };
  grounding?: unknown;
  reasoning?: ModelReasoning;
  stopReason?: string;
  toolCalls?: MessageToolCall[];
  usage?: ModelUsage;
}

const TOKEN_LIMIT_STOP_REASONS = new Set(['length', 'max_tokens', 'max_output_tokens']);

/** OpenAI `length`, Anthropic `max_tokens`, Gemini `MAX_TOKENS` — incomplete generation. */
export const isIncompleteLengthStop = (reason?: string): boolean =>
  !!reason && TOKEN_LIMIT_STOP_REASONS.has(reason.trim().toLowerCase());

export interface ProtocolStreamHandlers {
  onReasoning?: (text: string, reasoning: ModelReasoning) => void | Promise<void>;
  onText?: (delta: string, content: string) => void | Promise<void>;
  onToolCalls?: (toolCalls: MessageToolCall[]) => void | Promise<void>;
  signal?: AbortSignal;
}

const parseSseBlocks = (chunk: string) => {
  const events: Array<{ data?: string; event?: string }> = [];
  const blocks = chunk.split('\n\n');
  for (const block of blocks) {
    if (!block.trim() || block.startsWith(':')) continue;
    const parsed: { data?: string; event?: string } = {};
    for (const line of block.split('\n')) {
      if (line.startsWith('event:')) parsed.event = line.slice(6).trim();
      else if (line.startsWith('data:')) {
        parsed.data = `${parsed.data ?? ''}${line.slice(5).trim()}`;
      }
    }
    if (parsed.event || parsed.data) events.push(parsed);
  }
  return events;
};

export const consumeProtocolResponse = async (
  response: Response,
  handlers: ProtocolStreamHandlers = {},
): Promise<ProtocolStreamResult> => {
  if (!response.body) {
    throw new Error('Model runtime returned an empty response body');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let content = '';
  let thinking = '';
  const thinkingSignatures: string[] = [];
  const redactedSignatures: string[] = [];
  let toolCalls: MessageToolCall[] | undefined;
  let usage: ModelUsage | undefined;
  let grounding: unknown;
  let error: ProtocolStreamResult['error'];
  let stopReason: string | undefined;

  const consumeEvents = async (complete: string) => {
    for (const ev of parseSseBlocks(complete)) {
      if (!ev.data && ev.event !== 'stop') continue;
      let data: any;
      try {
        data = ev.data ? JSON.parse(ev.data) : '';
      } catch {
        if (ev.event === 'stop') stopReason = ev.data;
        continue;
      }

      switch (ev.event) {
        case 'stop': {
          stopReason = typeof data === 'string' ? data : String(data ?? '');
          break;
        }
        case 'text': {
          if (!data) break;
          content += data;
          await handlers.onText?.(data, content);
          break;
        }
        case 'reasoning': {
          if (!data) break;
          thinking += data;
          await handlers.onReasoning?.(data, { content: thinking });
          break;
        }
        case 'reasoning_signature': {
          thinkingSignatures.push(data);
          break;
        }
        case 'flagged_reasoning_signature': {
          redactedSignatures.push(data);
          break;
        }
        case 'tool_calls': {
          toolCalls = parseToolCalls(toolCalls || [], data);
          await handlers.onToolCalls?.(toolCalls);
          break;
        }
        case 'usage': {
          usage = data;
          break;
        }
        case 'grounding': {
          grounding = data;
          break;
        }
        case 'error': {
          error = {
            body: data,
            message: data?.message || 'Model stream error',
            type: data?.type || 'StreamChunkError',
          };
          break;
        }
        default: {
          break;
        }
      }
    }
  };

  try {
    // eslint-disable-next-line no-constant-condition
    while (true) {
      if (handlers.signal?.aborted) break;
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lastBreak = buffer.lastIndexOf('\n\n');
      if (lastBreak < 0) continue;
      const complete = buffer.slice(0, lastBreak + 2);
      buffer = buffer.slice(lastBreak + 2);
      await consumeEvents(complete);
    }
    if (!handlers.signal?.aborted) {
      buffer += decoder.decode();
      if (buffer.trim()) await consumeEvents(buffer);
    }
  } finally {
    try {
      await reader.cancel();
    } catch {
      // already closed
    }
    try {
      reader.releaseLock();
    } catch {
      // cancel() may already release the lock
    }
  }

  const reasoning: ModelReasoning | undefined = thinking
    ? {
        content: thinking,
        ...(thinkingSignatures[0] ? { signature: thinkingSignatures[0] } : {}),
      }
    : undefined;

  return { content, error, grounding, reasoning, stopReason, toolCalls, usage };
};
