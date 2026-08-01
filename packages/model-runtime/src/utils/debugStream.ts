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
  console.log(stringifyPrettySafely(response) + '\n');
};

const stringifySafely = (value: unknown) => {
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
};

const stringifyPrettySafely = (value: unknown) => {
  try {
    return JSON.stringify(value, null, 2) ?? String(value);
  } catch {
    return String(value);
  }
};

/**
 * Human-readable request dump for DEBUG_*_CHAT_COMPLETION / _RESPONSES flags.
 * The payload is pretty-printed with `messages`/`input` elided, then each
 * message's content is printed as real text (not a JSON-escaped single line),
 * so a multi-KB system prompt stays inspectable in docker logs. Debug output
 * is opt-in, so nothing is truncated.
 */
export const debugRequestPayload = (payload: any) => {
  logSafely(`[requestPayload] ${getTime()}`);
  try {
    const { input, messages, system, ...rest } = payload ?? {};
    logSafely(stringifyPrettySafely(rest));

    // Anthropic-style top-level system prompt (string or text-block array)
    if (system !== undefined) {
      logSafely(
        `[system] (${typeof system === 'string' ? `${system.length} chars` : 'structured'})`,
      );
      logSafely(typeof system === 'string' ? system : stringifyPrettySafely(system));
      logSafely('');
    }

    const turns = Array.isArray(messages) ? messages : Array.isArray(input) ? input : undefined;
    if (turns) {
      for (const [i, turn] of turns.entries()) {
        const { content, role, ...extras } = (turn ?? {}) as Record<string, any>;
        const size = typeof content === 'string' ? `${content.length} chars` : 'structured';
        const extraSuffix =
          Object.keys(extras).length > 0 ? ` ${stringifySafely(extras)}` : '';

        logSafely(`[message ${i}] role=${role} (${size})${extraSuffix}`);
        logSafely(typeof content === 'string' ? content : stringifyPrettySafely(content));
        logSafely('');
      }
    }
  } catch {
    logSafely(stringifySafely(payload));
  }
  logSafely('');
};

/**
 * Per-chunk debug logger for SDK AsyncIterable streams (used via
 * tapAsyncIterable), matching debugStream's [stream start] / [chunk N] /
 * [stream finished] format, plus an assembled summary at the end so the
 * response can be read without joining hundreds of delta chunks by hand.
 * Understands OpenAI chat-completion chunks and Responses API events;
 * unknown shapes still get the per-chunk log, just no summary.
 */
export const createChunkDebugTap = () => {
  let chunkIndex = 0;
  let text = '';
  let reasoning = '';
  const toolCalls = new Map<number, { args: string; name?: string }>();
  let usage: unknown;

  const collect = (chunk: any) => {
    // OpenAI chat-completion chunk deltas
    const delta = chunk?.choices?.[0]?.delta;
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

    // Responses API events
    if (typeof chunk?.type === 'string' && typeof chunk?.delta === 'string') {
      if (chunk.type.endsWith('output_text.delta')) text += chunk.delta;
      if (chunk.type.includes('reasoning')) reasoning += chunk.delta;
    }

    if (chunk?.usage) usage = chunk.usage;
    if (chunk?.response?.usage) usage = chunk.response.usage;
  };

  const onChunk = (chunk: unknown) => {
    if (chunkIndex === 0) logSafely(`[stream start] ${getTime()}`);
    logSafely(`[chunk ${chunkIndex}] ${getTime()}`);
    logSafely(stringifySafely(chunk));
    chunkIndex += 1;
    try {
      collect(chunk);
    } catch {
      // the assembled summary is best-effort; per-chunk logs already happened
    }
  };

  const onDone = () => {
    logSafely(`[stream finished] total chunks: ${chunkIndex}`);
    if (reasoning) {
      logSafely('[assembled reasoning]');
      logSafely(reasoning);
    }
    if (text) {
      logSafely('[assembled text]');
      logSafely(text);
    }
    for (const [index, call] of toolCalls) {
      logSafely(`[tool call ${index}] ${call.name ?? '(unnamed)'} ${call.args}`);
    }
    if (usage) logSafely(`[usage] ${stringifySafely(usage)}`);
    logSafely('');
  };

  return { onChunk, onDone };
};
