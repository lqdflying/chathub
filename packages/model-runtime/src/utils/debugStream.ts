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
  console.log(JSON.stringify(response) + '\n');
};
