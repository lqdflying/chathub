import { LOBE_CHAT_OBSERVATION_ID, LOBE_CHAT_TRACE_ID, MESSAGE_CANCEL_FLAT } from '@lobechat/const';
import { parseToolCalls } from '@lobechat/model-runtime';
import {
  ChatErrorType,
  ChatImageChunk,
  ChatMessageError,
  ContextExportRequestSnapshot,
  GroundingSearch,
  MessageToolCall,
  ModelPerformance,
  ModelReasoning,
  ModelUsage,
  ResponseAnimation,
  ResponseAnimationStyle,
} from '@lobechat/types';
import { fetchEventSource } from '@lobechat/utils/client/fetchEventSource/index';
import { nanoid } from '@lobechat/utils/uuid';

import { getMessageError } from './parseError';

type SSEFinishType = 'done' | 'error' | 'abort';

export type ChatStreamInterruptKind =
  | 'abort'
  | 'failed_to_fetch'
  | 'other'
  | 'webkit_load_failed';

export interface ChatStreamInterruptInfo {
  errorClass?: string;
  errorKind: ChatStreamInterruptKind;
}

const interruptMessage = (error: unknown) => {
  if (typeof error === 'string') return error;
  if (error instanceof Error) return error.message;
  if (error && typeof error === 'object' && 'message' in error) {
    return String((error as { message?: unknown }).message ?? '');
  }
  return '';
};

const interruptName = (error: unknown) => {
  if (error && typeof error === 'object' && 'name' in error) {
    return String((error as { name?: unknown }).name ?? '');
  }
  return '';
};

export const classifyChatStreamFetchError = (error: unknown): ChatStreamInterruptKind => {
  if (error === MESSAGE_CANCEL_FLAT) return 'abort';
  const normalized = interruptMessage(error).toLowerCase();
  if (normalized === 'load failed') return 'webkit_load_failed';
  if (normalized === 'failed to fetch') return 'failed_to_fetch';
  if (interruptName(error) === 'AbortError' || normalized === 'aborterror') return 'abort';
  return 'other';
};

export const isChatStreamNetworkInterrupt = (error: unknown) =>
  classifyChatStreamFetchError(error) !== 'other';

export const describeChatStreamInterrupt = (error: unknown): ChatStreamInterruptInfo => ({
  errorClass: interruptName(error) || (error instanceof Error ? error.constructor.name : undefined),
  errorKind: classifyChatStreamFetchError(error),
});

export type OnFinishHandler = (
  text: string,
  context: {
    grounding?: GroundingSearch;
    images?: ChatImageChunk[];
    observationId?: string | null;
    reasoning?: ModelReasoning;
    speed?: ModelPerformance;
    toolCalls?: MessageToolCall[];
    traceId?: string | null;
    type?: SSEFinishType;
    usage?: ModelUsage;
  },
) => Promise<void>;

export interface MessageUsageChunk {
  type: 'usage';
  usage: ModelUsage;
}

export interface MessageSpeedChunk {
  speed: ModelPerformance;
  type: 'speed';
}

export interface MessageTextChunk {
  text: string;
  type: 'text';
}

export interface MessageBase64ImageChunk {
  id: string;
  image: ChatImageChunk;
  images: ChatImageChunk[];
  type: 'base64_image';
}

export interface MessageReasoningChunk {
  signature?: string;
  text?: string;
  type: 'reasoning';
}

export interface MessageGroundingChunk {
  grounding: GroundingSearch;
  type: 'grounding';
}

interface MessageToolCallsChunk {
  isAnimationActives?: boolean[];
  tool_calls: MessageToolCall[];
  type: 'tool_calls';
}

export interface FetchSSEOptions {
  fetcher?: typeof fetch;
  onAbort?: (text: string, interrupt?: ChatStreamInterruptInfo) => Promise<void>;
  onContextSnapshot?: (snapshot: ContextExportRequestSnapshot) => void;
  onErrorHandle?: (error: ChatMessageError) => void;
  onFinish?: OnFinishHandler;
  onMessageHandle?: (
    chunk:
      | MessageTextChunk
      | MessageToolCallsChunk
      | MessageReasoningChunk
      | MessageGroundingChunk
      | MessageUsageChunk
      | MessageBase64ImageChunk
      | MessageSpeedChunk,
  ) => void;
  responseAnimation?: ResponseAnimation;
}

const START_ANIMATION_SPEED = 10; // 默认起始速度

const createSmoothMessage = (params: {
  onTextUpdate: (delta: string, text: string) => void;
  startSpeed?: number;
}) => {
  const { startSpeed = START_ANIMATION_SPEED } = params;

  let buffer = '';
  let outputQueue: string[] = [];
  let isAnimationActive = false;
  let animationFrameId: number | null = null;
  let lastFrameTime = 0;
  let accumulatedTime = 0;
  let currentSpeed = startSpeed;
  let lastQueueLength = 0; // 记录上一帧的队列长度

  const stopAnimation = () => {
    isAnimationActive = false;
    if (animationFrameId !== null) {
      cancelAnimationFrame(animationFrameId);
      animationFrameId = null;
    }
  };

  const startAnimation = (speed = startSpeed) => {
    return new Promise<void>((resolve) => {
      if (isAnimationActive) {
        resolve();
        return;
      }

      isAnimationActive = true;
      lastFrameTime = performance.now();
      accumulatedTime = 0;
      currentSpeed = speed;
      lastQueueLength = 0; // 重置上一帧队列长度

      const updateText = (timestamp: number) => {
        if (!isAnimationActive) {
          if (animationFrameId !== null) {
            cancelAnimationFrame(animationFrameId);
          }
          resolve();
          return;
        }

        const frameDuration = timestamp - lastFrameTime;
        lastFrameTime = timestamp;
        accumulatedTime += frameDuration;

        let charsToProcess = 0;
        if (outputQueue.length > 0) {
          // 更平滑的速度调整
          const targetSpeed = Math.max(speed, outputQueue.length);
          // 根据队列长度变化调整速度变化率
          const speedChangeRate = Math.abs(outputQueue.length - lastQueueLength) * 0.0008 + 0.005;
          currentSpeed += (targetSpeed - currentSpeed) * speedChangeRate;

          charsToProcess = Math.floor((accumulatedTime * currentSpeed) / 1000);
        }

        if (charsToProcess > 0) {
          accumulatedTime -= (charsToProcess * 1000) / currentSpeed;

          let actualChars = Math.min(charsToProcess, outputQueue.length);
          // actualChars = Math.min(speed, actualChars); // 速度上限

          // if (actualChars * 2 < outputQueue.length && /[\dA-Za-z]/.test(outputQueue[actualChars])) {
          //   actualChars *= 2;
          // }

          const charsToAdd = outputQueue.splice(0, actualChars).join('');
          buffer += charsToAdd;
          params.onTextUpdate(charsToAdd, buffer);
        }

        lastQueueLength = outputQueue.length; // 更新上一帧的队列长度

        if (outputQueue.length > 0 && isAnimationActive) {
          animationFrameId = requestAnimationFrame(updateText);
        } else {
          isAnimationActive = false;
          animationFrameId = null;
          resolve();
        }
      };

      animationFrameId = requestAnimationFrame(updateText);
    });
  };

  const pushToQueue = (text: string) => {
    outputQueue.push(...text.split(''));
  };

  return {
    isAnimationActive,
    isTokenRemain: () => outputQueue.length > 0,
    pushToQueue,
    startAnimation,
    stopAnimation,
  };
};

export const standardizeAnimationStyle = (
  animationStyle?: ResponseAnimation,
): Exclude<ResponseAnimation, ResponseAnimationStyle> => {
  return typeof animationStyle === 'object' ? animationStyle : { text: animationStyle };
};

/**
 * Fetch data using stream method
 */
// eslint-disable-next-line no-undef
export const fetchSSE = async (url: string, options: RequestInit & FetchSSEOptions = {}) => {
  let toolCalls: undefined | MessageToolCall[];
  let triggerOnMessageHandler = false;

  let finishedType: SSEFinishType = 'done';
  let response!: Response;

  const { text, speed: smoothingSpeed } = standardizeAnimationStyle(
    options.responseAnimation ?? {},
  );
  const shouldSkipTextProcessing = text === 'none';
  const textSmoothing = text === 'smooth';

  // 添加文本buffer和计时器相关变量
  let textBuffer = '';
  let bufferTimer: ReturnType<typeof setTimeout> | null = null;
  const BUFFER_INTERVAL = 300; // 300ms

  const flushTextBuffer = () => {
    if (textBuffer) {
      options.onMessageHandle?.({ text: textBuffer, type: 'text' });
      textBuffer = '';
    }
  };

  let output = '';
  const textController = createSmoothMessage({
    onTextUpdate: (delta, text) => {
      output = text;
      options.onMessageHandle?.({ text: delta, type: 'text' });
    },
    startSpeed: smoothingSpeed,
  });

  let thinking = '';
  // Anthropic emits exactly one signed `thinking` block per assistant turn
  // (docs: "the thinking block opens, a single signature_delta arrives").
  // We keep an array for resilience but only use the first entry; if the API
  // ever emits multiple regular thinking blocks, the type would need to grow.
  let thinkingSignatures: string[] = [];
  // `redacted_thinking` blocks ARE allowed in multiples within one response.
  let redactedSignatures: string[] = [];

  const thinkingController = createSmoothMessage({
    onTextUpdate: (delta, text) => {
      thinking = text;
      options.onMessageHandle?.({ text: delta, type: 'reasoning' });
    },
    startSpeed: smoothingSpeed,
  });

  let thinkingBuffer = '';
  let thinkingBufferTimer: ReturnType<typeof setTimeout> | null = null;

  // 创建一个函数来处理buffer的刷新
  const flushThinkingBuffer = () => {
    if (thinkingBuffer) {
      options.onMessageHandle?.({ text: thinkingBuffer, type: 'reasoning' });
      thinkingBuffer = '';
    }
  };

  let grounding: GroundingSearch | undefined = undefined;
  let usage: ModelUsage | undefined = undefined;
  let images: ChatImageChunk[] = [];
  let speed: ModelPerformance | undefined = undefined;

  await fetchEventSource(url, {
    body: options.body,
    fetch: options?.fetcher,
    headers: options.headers as Record<string, string>,
    method: options.method,
    onerror: (error) => {
      if (isChatStreamNetworkInterrupt(error)) {
        finishedType = 'abort';
        // Keep abort and error callbacks mutually exclusive. Callers such as
        // Connectivity Check convert empty WebKit interrupts in onAbort; chat
        // Stop-before-first-token must not also receive onErrorHandle.
        options?.onAbort?.(output, describeChatStreamInterrupt(error));
        textController.stopAnimation();
      } else {
        finishedType = 'error';

        options.onErrorHandle?.(
          error.type
            ? error
            : {
                body: {
                  message: error.message,
                  name: error.name,
                  stack: error.stack,
                },
                message: error.message,
                type: ChatErrorType.UnknownChatFetchError,
              },
        );
        return;
      }
    },
    onmessage: (ev) => {
      // SSE comment heartbeats contain neither an event nor data payload.
      if (!ev.event && !ev.data) return;

      triggerOnMessageHandler = true;
      let data;
      try {
        data = JSON.parse(ev.data);
      } catch (e) {
        console.warn('parse error:', e);
        options.onErrorHandle?.({
          body: {
            context: {
              chunk: ev.data,
              error: { message: (e as Error).message, name: (e as Error).name },
            },
            message:
              'chat response streaming chunk parse error, please contact your API Provider to fix it.',
          },
          message: 'parse error',
          type: 'StreamChunkError',
        });

        return;
      }

      switch (ev.event) {
        case 'context_snapshot': {
          options.onContextSnapshot?.(data);
          break;
        }

        case 'error': {
          finishedType = 'error';
          options.onErrorHandle?.(data);
          break;
        }

        case 'base64_image': {
          const id = 'tmp_img_' + nanoid();
          const item = { data, id, isBase64: true };
          images.push(item);

          options.onMessageHandle?.({ id, image: item, images, type: 'base64_image' });
          break;
        }

        case 'text': {
          // skip empty text
          if (!data) break;

          if (shouldSkipTextProcessing) {
            output += data;
            options.onMessageHandle?.({ text: data, type: 'text' });
          } else if (textSmoothing) {
            textController.pushToQueue(data);

            if (!textController.isAnimationActive) textController.startAnimation();
          } else {
            output += data;

            // 使用buffer机制
            textBuffer += data;

            // 如果还没有设置计时器，创建一个
            if (!bufferTimer) {
              bufferTimer = setTimeout(() => {
                flushTextBuffer();
                bufferTimer = null;
              }, BUFFER_INTERVAL);
            }
          }

          break;
        }

        case 'usage': {
          usage = data;
          options.onMessageHandle?.({ type: 'usage', usage: data });
          break;
        }

        case 'speed': {
          speed = data;
          options.onMessageHandle?.({ speed: data, type: 'speed' });
          break;
        }

        case 'grounding': {
          grounding = data;
          options.onMessageHandle?.({ grounding: data, type: 'grounding' });
          break;
        }

        case 'flagged_reasoning_signature': {
          redactedSignatures.push(data);
          break;
        }

        case 'reasoning_signature': {
          thinkingSignatures.push(data);
          break;
        }

        case 'reasoning': {
          if (textSmoothing) {
            thinkingController.pushToQueue(data);

            if (!thinkingController.isAnimationActive) thinkingController.startAnimation();
          } else {
            thinking += data;

            // 使用buffer机制
            thinkingBuffer += data;

            // 如果还没有设置计时器，创建一个
            if (!thinkingBufferTimer) {
              thinkingBufferTimer = setTimeout(() => {
                flushThinkingBuffer();
                thinkingBufferTimer = null;
              }, BUFFER_INTERVAL);
            }
          }

          break;
        }

        case 'tool_calls': {
          // get finial
          // if there is no tool calls, we should initialize the tool calls
          if (!toolCalls) toolCalls = [];
          toolCalls = parseToolCalls(toolCalls, data);
          options.onMessageHandle?.({ tool_calls: toolCalls, type: 'tool_calls' });
        }
      }
    },
    onopen: async (res) => {
      response = res.clone();
      // 如果不 ok 说明有请求错误
      if (!response.ok) {
        const messageError = await getMessageError(res);
        if (messageError.body && typeof messageError.body === 'object') {
          const { contextExportSnapshot, ...errorBody } = messageError.body as Record<
            string,
            unknown
          >;

          if (contextExportSnapshot) {
            options.onContextSnapshot?.(
              contextExportSnapshot as ContextExportRequestSnapshot,
            );
            throw { ...messageError, body: errorBody };
          }
        }

        throw messageError;
      }
    },
    signal: options.signal,
  });

  // only call onFinish when response is available
  // so like abort, we don't need to call onFinish
  if (response) {
    textController.stopAnimation();

    // 确保所有缓冲区数据都被处理
    if (bufferTimer) {
      clearTimeout(bufferTimer);
      flushTextBuffer();
    }

    if (thinkingBufferTimer) {
      clearTimeout(thinkingBufferTimer);
      flushThinkingBuffer();
    }

    if (response.ok) {
      // if there is no onMessageHandler, we should call onHandleMessage first
      if (!triggerOnMessageHandler) {
        output = await response.clone().text();
        options.onMessageHandle?.({ text: output, type: 'text' });
      }

      const traceId = response.headers.get(LOBE_CHAT_TRACE_ID);
      const observationId = response.headers.get(LOBE_CHAT_OBSERVATION_ID);

      if (textController.isTokenRemain()) {
        await textController.startAnimation(smoothingSpeed);
      }

      await options?.onFinish?.(output, {
        grounding,
        images: images.length > 0 ? images : undefined,
        observationId,
        reasoning:
          !!thinking || thinkingSignatures.length > 0 || redactedSignatures.length > 0
            ? {
                content: thinking || undefined,
                redactedSignatures: redactedSignatures.length > 0 ? redactedSignatures : undefined,
                signature: thinkingSignatures[0],
              }
            : undefined,
        speed,
        toolCalls,
        traceId,
        type: finishedType,
        usage,
      });
    }
  }

  return response;
};
