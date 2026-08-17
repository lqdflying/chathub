import { parseToolCalls } from '@lobechat/model-runtime';
import type { MessageToolCall, ModelReasoning, ModelUsage } from '@lobechat/types';

export interface ProtocolStreamResult {
  content: string;
  error?: { body?: unknown; message: string; type: string };
  grounding?: unknown;
  reasoning?: ModelReasoning;
  toolCalls?: MessageToolCall[];
  usage?: ModelUsage;
}

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

  const consumeEvents = async (complete: string) => {
    for (const ev of parseSseBlocks(complete)) {
      if (!ev.data) continue;
      let data: any;
      try {
        data = JSON.parse(ev.data);
      } catch {
        continue;
      }

      switch (ev.event) {
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
    buffer += decoder.decode();
    if (buffer.trim()) await consumeEvents(buffer);
  } finally {
    reader.releaseLock();
  }

  const reasoning: ModelReasoning | undefined = thinking
    ? {
        content: thinking,
        ...(thinkingSignatures[0] ? { signature: thinkingSignatures[0] } : {}),
      }
    : undefined;

  return { content, error, grounding, reasoning, toolCalls, usage };
};
