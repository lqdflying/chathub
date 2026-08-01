// no need to introduce a package to get the current time as this module is just a debug utility
const getTime = () => {
  const date = new Date();
  return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()} ${date.getHours()}:${date.getMinutes()}:${date.getSeconds()}.${date.getMilliseconds()}`;
};

const formatChunk = (value: unknown, decoder: TextDecoder): unknown => {
  if (value instanceof ArrayBuffer) {
    return decoder.decode(new Uint8Array(value), { stream: true });
  }

  if (ArrayBuffer.isView(value)) {
    const bytes = Uint8Array.from(new Uint8Array(value.buffer, value.byteOffset, value.byteLength));
    return decoder.decode(bytes, { stream: true });
  }

  if (typeof value !== 'string') {
    return JSON.stringify(value);
  }

  return value;
};

const formatChunkSafely = (value: unknown, decoder: TextDecoder): unknown => {
  try {
    return formatChunk(value, decoder);
  } catch {
    return `[unformattable chunk: ${Object.prototype.toString.call(value)}]`;
  }
};

const logSafely = (...values: unknown[]) => {
  try {
    console.log(...values);
  } catch {
    // Debug output must never alter the provider stream.
  }
};

export const createDebugStreamTransformer = <Chunk>() => {
  let chunkIndex = 0;
  const decoder = new TextDecoder();

  return new TransformStream<Chunk, Chunk>({
    flush() {
      logSafely(`[stream finished] total chunks: ${chunkIndex}\n`);
    },
    start() {
      logSafely(`[stream start] ${getTime()}`);
    },
    transform(value, controller) {
      controller.enqueue(value);
      logSafely(`[chunk ${chunkIndex}] ${getTime()}`);
      logSafely(formatChunkSafely(value, decoder));
      logSafely('');
      chunkIndex += 1;
    },
  });
};

export const debugStream = async (stream: ReadableStream) => {
  let finished = false;
  let chunk = 0;
  let chunkValue: any;
  const decoder = new TextDecoder();

  const reader = stream.getReader();

  console.log(`[stream start] ${getTime()}`);

  while (!finished) {
    try {
      const { value, done } = await reader.read();

      if (done) {
        console.log(`[stream finished] total chunks: ${chunk}\n`);
        finished = true;
        break;
      }

      chunkValue = value;

      chunkValue = formatChunk(value, decoder);

      console.log(`[chunk ${chunk}] ${getTime()}`);
      console.log(chunkValue);
      console.log('');

      finished = done;
      chunk++;
    } catch (e) {
      finished = true;
      console.error('[debugStream error]', e);
      console.error('[error chunk value:]', chunkValue);
    }
  }
};

export const debugResponse = (response: any) => {
  console.log(`\n[no stream response] ${getTime()}\n`);
  console.log(stringifySafely(response) + '\n');
};

const stringifySafely = (value: unknown) => {
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
};

/**
 * Request dump for DEBUG_*_CHAT_COMPLETION / _RESPONSES flags: a marker line
 * with the timestamp, then the entire payload as ONE compact JSON line — one
 * request, one complete log record. Multi-line prompt content stays
 * JSON-escaped inside the record so docker log lines never interleave or
 * split a record. Debug output is opt-in, so nothing is truncated.
 */
export const debugRequestPayload = (payload: any) => {
  logSafely(`[requestPayload] ${getTime()}`);
  logSafely(stringifySafely(payload));
};

/**
 * Stream debug logger for SDK AsyncIterable streams (used via
 * tapAsyncIterable). Delta chunks belong to one message, so they are merged
 * instead of logged one line per token: recognized OpenAI chat-completion
 * chunks and Responses API events are only collected, and the end of the
 * stream emits ONE compact JSON record with the assembled message (id,
 * model, finish reason, text, reasoning, tool calls, usage) between
 * [stream start] / [stream finished] markers. Chunks of unknown shape still
 * log individually so transport bugs stay visible.
 */
export const createChunkDebugTap = () => {
  let chunkIndex = 0;
  let id: string | undefined;
  let model: string | undefined;
  let finishReason: string | undefined;
  let text = '';
  let reasoning = '';
  const toolCalls = new Map<number, { args: string; name?: string }>();
  let usage: unknown;

  // returns true when the chunk shape is recognized and merged into the record
  const collect = (chunk: any): boolean => {
    if (!chunk || typeof chunk !== 'object') return false;

    // OpenAI chat-completion chunks (including empty-choices usage chunks)
    if (Array.isArray(chunk.choices)) {
      if (typeof chunk.id === 'string') id = chunk.id;
      if (typeof chunk.model === 'string') model = chunk.model;

      const choice = chunk.choices[0];
      const delta = choice?.delta;
      if (typeof choice?.finish_reason === 'string') finishReason = choice.finish_reason;
      if (typeof delta?.content === 'string') text += delta.content;
      if (typeof delta?.reasoning_content === 'string') reasoning += delta.reasoning_content;
      if (Array.isArray(delta?.tool_calls)) {
        for (const call of delta.tool_calls) {
          const slot = toolCalls.get(call?.index ?? 0) ?? { args: '' };
          if (call?.function?.name) slot.name = call.function.name;
          if (typeof call?.function?.arguments === 'string') slot.args += call.function.arguments;
          toolCalls.set(call?.index ?? 0, slot);
        }
      }
      if (chunk.usage) usage = chunk.usage;
      return true;
    }

    // Anthropic Messages events
    if (
      typeof chunk.type === 'string' &&
      (chunk.type.startsWith('message_') ||
        chunk.type.startsWith('content_block_') ||
        chunk.type === 'ping')
    ) {
      if (typeof chunk.message?.id === 'string') id = chunk.message.id;
      if (typeof chunk.message?.model === 'string') model = chunk.message.model;
      // usage arrives split across message_start (input) and message_delta (output)
      if (chunk.message?.usage) usage = { ...(usage as object), ...chunk.message.usage };
      if (chunk.type === 'content_block_start' && chunk.content_block?.type === 'tool_use') {
        const slot = toolCalls.get(chunk.index ?? 0) ?? { args: '' };
        if (typeof chunk.content_block.name === 'string') slot.name = chunk.content_block.name;
        toolCalls.set(chunk.index ?? 0, slot);
      }
      if (chunk.type === 'content_block_delta') {
        if (typeof chunk.delta?.text === 'string') text += chunk.delta.text;
        if (typeof chunk.delta?.thinking === 'string') reasoning += chunk.delta.thinking;
        if (typeof chunk.delta?.partial_json === 'string') {
          const slot = toolCalls.get(chunk.index ?? 0) ?? { args: '' };
          slot.args += chunk.delta.partial_json;
          toolCalls.set(chunk.index ?? 0, slot);
        }
      }
      if (chunk.type === 'message_delta') {
        if (typeof chunk.delta?.stop_reason === 'string') finishReason = chunk.delta.stop_reason;
        if (chunk.usage) usage = { ...(usage as object), ...chunk.usage };
      }
      return true;
    }

    // Responses API events
    if (typeof chunk.type === 'string' && chunk.type.startsWith('response.')) {
      if (typeof chunk.delta === 'string') {
        if (chunk.type.endsWith('output_text.delta')) text += chunk.delta;
        else if (chunk.type.includes('reasoning')) reasoning += chunk.delta;
      }
      if (typeof chunk.response?.id === 'string') id = chunk.response.id;
      if (typeof chunk.response?.model === 'string') model = chunk.response.model;
      if (chunk.response?.usage) usage = chunk.response.usage;
      return true;
    }

    return false;
  };

  const onChunk = (chunk: unknown) => {
    if (chunkIndex === 0) logSafely(`[stream start] ${getTime()}`);
    chunkIndex += 1;

    let merged = false;
    try {
      merged = collect(chunk);
    } catch {
      merged = false;
    }
    // unrecognized shapes are not part of the assembled record — keep them visible
    if (!merged) logSafely(stringifySafely(chunk));
  };

  const onDone = () => {
    logSafely(`[stream finished] total chunks: ${chunkIndex}`);

    const record: Record<string, unknown> = {};
    if (id) record.id = id;
    if (model) record.model = model;
    if (finishReason) record.finishReason = finishReason;
    if (reasoning) record.reasoning = reasoning;
    if (text) record.text = text;
    if (toolCalls.size > 0)
      record.toolCalls = [...toolCalls.entries()].map(([index, call]) => ({
        arguments: call.args,
        index,
        name: call.name,
      }));
    if (usage) record.usage = usage;

    if (Object.keys(record).length > 0) logSafely(stringifySafely(record));
  };

  return { onChunk, onDone };
};
