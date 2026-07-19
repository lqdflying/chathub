import {
  ModelPerformance,
  ModelTokensUsage,
  ModelUsage,
  ToolCacheDebugMetadata,
} from '@lobechat/types';

import { MessageToolCall, MessageToolCallChunk } from './toolsCalling';

export type LLMRoleType = 'user' | 'system' | 'assistant' | 'function' | 'tool';

export type ChatResponseFormat =
  | { type: 'json_object' }
  | {
      json_schema: {
        name: string;
        schema: Record<string, any>;
        strict?: boolean;
      };
      type: 'json_schema';
    };

interface UserMessageContentPartThinking {
  signature: string;
  thinking: string;
  type: 'thinking';
}
interface UserMessageContentPartRedactedThinking {
  data: string;
  type: 'redacted_thinking';
}
interface UserMessageContentPartText {
  text: string;
  type: 'text';
}

interface UserMessageContentPartImage {
  image_url: {
    detail?: 'auto' | 'low' | 'high';
    url: string;
  };
  type: 'image_url';
}

interface UserMessageContentPartVideo {
  type: 'video_url';
  video_url: { url: string };
}

export type UserMessageContentPart =
  | UserMessageContentPartText
  | UserMessageContentPartImage
  | UserMessageContentPartVideo
  | UserMessageContentPartThinking
  | UserMessageContentPartRedactedThinking;

export interface OpenAIChatMessage {
  content: string | UserMessageContentPart[];
  name?: string;
  reasoning?: {
    content?: string;
    duration?: number;
  };
  role: LLMRoleType;
  tool_call_id?: string;
  tool_calls?: MessageToolCall[];
}

export interface OpenAICompatCacheRequestConfig {
  chat?: {
    promptCacheKey?: boolean;
    sessionHeader?: boolean;
  };
  responses?: {
    promptCacheKey?: 'derived' | 'off';
    sessionHeader?: boolean;
    store?: 'default' | 'false' | 'true';
  };
}

export interface OpenAICompatResponsesParamsRequestConfig {
  maxOutputTokens?: boolean;
  maxTokens?: boolean;
  truncation?: 'auto' | 'disabled' | 'off';
  verbosity?: 'both' | 'off' | 'text' | 'top-level';
}

/**
 * @title Chat Stream Payload
 */
export interface ChatStreamPayload {
  apiMode?: 'chatCompletion' | 'responses';
  debugToolCache?: ToolCacheDebugMetadata;
  /**
   * 开启上下文缓存
   */
  enabledContextCaching?: boolean;
  /**
   * 是否开启搜索
   */
  enabledSearch?: boolean;
  /**
   * @title 控制生成文本中的惩罚系数，用于减少重复性
   * @default 0
   */
  frequency_penalty?: number;
  /**
   * @title 生成文本的最大长度
   */
  max_output_tokens?: number;
  max_tokens?: number;
  /**
   * @title 聊天信息列表
   */
  messages: OpenAIChatMessage[];
  /**
   * @title 模型名称
   */
  model: string;
  /**
   * @title 返回的文本数量
   */
  n?: number;
  openAICompatCache?: OpenAICompatCacheRequestConfig;
  openAICompatResponsesParams?: OpenAICompatResponsesParamsRequestConfig;
  /**
   * @title 控制生成文本中的惩罚系数，用于减少主题的变化
   * @default 0
   */
  presence_penalty?: number;
  prompt_cache_key?: string;
  provider?: string;
  /**
   * MiniMax OpenAI-compatible (`api.minimax.io/v1`): when true, interleaved thinking is
   * exposed as `reasoning_details` (see MiniMax OpenAI API `reasoning_split`).
   */
  reasoning?: {
    effort?: string;
    summary?: string;
  };
  reasoning_effort?: 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';
  reasoning_split?: boolean;
  responseMode?: 'stream' | 'json';
  responseStateMode?: 'provider' | 'stateless';
  response_format?: ChatResponseFormat;
  store?: boolean;
  /**
   * @title 是否开启流式请求
   * @default true
   */
  stream?: boolean;
  /**
   * @title 生成文本的随机度量，用于控制文本的创造性和多样性
   * @default 1
   */
  temperature?: number;
  text?: {
    verbosity?: 'low' | 'medium' | 'high';
  };
  /**
   * use for Claude and Gemini
   */
  thinking?: {
    budget_tokens: number;
    /**
     * Anthropic adaptive thinking (Opus 4.7+): mapped to `output_config.effort`.
     * Ignored for `thinking.type: "enabled"` on models that still use budget_tokens.
     */
    effort?: 'low' | 'medium' | 'high' | 'max' | 'xhigh';
    /**
     * Moonshot `kimi-k2.6` only: Preserved Thinking — forward historical `reasoning_content`
     * when `keep` is `all` (see Moonshot chat API `KimiK26ChatRequest`).
     */
    keep?: 'all' | null;
    type: 'adaptive' | 'disabled' | 'enabled';
  };
  thinkingBudget?: number;
  tool_choice?:
    | string
    | {
        function: { name: string };
        type: 'function';
      }
    | {
        name: string;
        type: 'function';
      };
  tools?: ChatCompletionTool[];
  /**
   * @title 控制生成文本中最高概率的单个令牌
   * @default 1
   */
  top_p?: number;
  truncation?: 'auto' | 'disabled';
  /**
   * @title Gemini URL 上下文获取工具开关
   */
  urlContext?: boolean;
  verbosity?: 'low' | 'medium' | 'high';
}

export interface ChatMethodOptions {
  callback?: ChatStreamCallbacks;
  /**
   * response headers
   */
  headers?: Record<string, any>;
  /**
   * send the request to the ai api endpoint
   */
  requestHeaders?: Record<string, any>;
  signal?: AbortSignal;
  /**
   * userId for the chat completion
   */
  user?: string;
}

export interface ChatCompletionFunctions {
  /**
   * The description of what the function does.
   * @type {string}
   * @memberof ChatCompletionFunctions
   */
  description?: string;
  /**
   * The name of the function to be called. Must be a-z, A-Z, 0-9, or contain underscores and dashes, with a maximum length of 64.
   * @type {string}
   * @memberof ChatCompletionFunctions
   */
  name: string;
  /**
   * The parameters the functions accepts, described as a JSON Schema object. See the [guide](/docs/guides/gpt/function-calling) for examples, and the [JSON Schema reference](https://json-schema.org/understanding-json-schema/) for documentation about the format.
   * @type {{ [key: string]: any }}
   * @memberof ChatCompletionFunctions
   */
  parameters?: {
    [key: string]: any;
  };
}

export interface ChatCompletionTool {
  function: ChatCompletionFunctions;

  /**
   * The type of the tool. Currently, only `function` is supported.
   */
  type: 'function';
}

export interface OnFinishData {
  grounding?: any;
  speed?: ModelPerformance;
  text: string;
  thinking?: string;
  toolsCalling?: MessageToolCall[];
  usage?: ModelUsage;
}

export interface ChatStreamCallbacks {
  onCompletion?: (data: OnFinishData) => Promise<void> | void;
  /**
   * `onFinal`: Called once when the stream is closed with the final completion message.
   **/
  onFinal?: (data: OnFinishData) => Promise<void> | void;
  onGrounding?: (grounding: any) => Promise<void> | void;
  /** `onStart`: Called once when the stream is initialized. */
  onStart?: () => Promise<void> | void;
  /** `onText`: Called for each text chunk. */
  onText?: (content: string) => Promise<void> | void;
  onThinking?: (content: string) => Promise<void> | void;
  onToolsCalling?: (data: {
    chunk: MessageToolCallChunk[];
    /**
     * full tools calling array
     */
    toolsCalling: MessageToolCall[];
  }) => Promise<void> | void;
  onUsage?: (usage: ModelTokensUsage) => Promise<void> | void;
}
