import debug from 'debug';

import { BaseProcessor } from '../base/BaseProcessor';
import type { PipelineContext, ProcessorOptions } from '../types';

/**
 * Placeholder generators whose values change within a single session (time,
 * randomness, UUIDs). Expanding these in a SYSTEM message on every request
 * breaks the prompt-cache prefix for providers that cache by byte-identical
 * prefix (OpenAI). Kept in sync with the generators defined in
 * `packages/utils/src/client/parserPlaceholder.ts`.
 */
const VOLATILE_GENERATOR_KEYS = new Set<string>([
  'time',
  'datetime',
  'iso',
  'timestamp',
  'hour',
  'minute',
  'second',
  'random',
  'random_bool',
  'random_float',
  'random_hex',
  'random_int',
  'random_string',
  'random_digit',
  'uuid',
  'uuid_short',
]);

const log = debug('context-engine:processor:PlaceholderVariablesProcessor');

const placeholderVariablesRegex = /{{(.*?)}}/g;

export interface PlaceholderVariablesConfig {
  /** Recursive parsing depth, default is 2 */
  depth?: number;
  /**
   * The runtime provider id. When `openaicompatible`, volatile placeholder
   * generators (time, random, uuid, etc.) are skipped in SYSTEM messages so
   * the system prompt stays byte-stable across requests and OpenAI prompt
   * caching keeps hitting. Other providers expand all placeholders as before.
   */
  provider?: string;
  /** Variable generators mapping, key is variable name, value is generator function */
  variableGenerators: Record<string, () => string>;
}

/**
 * Extract all {{variable}} placeholder variable names from text
 * @param text String containing template variables
 * @returns Array of variable names, e.g. ['date', 'nickname']
 */
const extractPlaceholderVariables = (text: string): string[] => {
  const matches = [...text.matchAll(placeholderVariablesRegex)];
  return matches.map((m) => m[1].trim());
};

/**
 * Replace template variables with actual values, supporting recursive parsing of nested variables
 * @param text - Original text containing variables
 * @param variableGenerators - Variable generators mapping
 * @param depth - Recursive depth, default 2, set higher to support {{date}} within {{text}}
 * @returns Text with variables replaced
 */
export const parsePlaceholderVariables = (
  text: string,
  variableGenerators: Record<string, () => string>,
  depth = 2,
): string => {
  let result = text;

  // Recursive parsing to handle cases like {{text}} containing additional preset variables
  for (let i = 0; i < depth; i++) {
    try {
      const extractedVariables = extractPlaceholderVariables(result);
      const availableVariables = Object.fromEntries(
        extractedVariables
          .map((key) => [key, variableGenerators[key]?.()])
          .filter(([, value]) => value !== undefined),
      );

      // Only perform replacement when there are available variables
      if (Object.keys(availableVariables).length === 0) break;

      // Replace variables one by one to avoid lodash template's error handling for undefined variables
      let tempResult = result;
      for (const [key, value] of Object.entries(availableVariables)) {
        const regex = new RegExp(
          `{{\\s*${key.replaceAll(/[$()*+.?[\\\]^{|}]/g, '\\$&')}\\s*}}`,
          'g',
        );
        // @ts-ignore
        tempResult = tempResult.replace(regex, value);
      }

      if (tempResult === result) break;
      result = tempResult;
    } catch {
      break;
    }
  }

  return result;
};

/**
 * Parse message content and replace placeholder variables
 * @param messages Original messages array
 * @param variableGenerators Variable generators mapping
 * @param depth Recursive parsing depth, default is 2
 * @returns Processed messages array
 */
export const parsePlaceholderVariablesMessages = (
  messages: any[],
  variableGenerators: Record<string, () => string>,
  depth = 2,
): any[] =>
  messages.map((message) => {
    if (!message?.content) return message;

    const { content } = message;

    // Handle string type directly
    if (typeof content === 'string') {
      return { ...message, content: parsePlaceholderVariables(content, variableGenerators, depth) };
    }

    // Handle array type by processing text elements
    if (Array.isArray(content)) {
      return {
        ...message,
        content: content.map((item) =>
          item?.type === 'text'
            ? { ...item, text: parsePlaceholderVariables(item.text, variableGenerators, depth) }
            : item,
        ),
      };
    }

    return message;
  });

/**
 * PlaceholderVariables Processor
 * Responsible for handling placeholder variable replacement in messages
 */
export class PlaceholderVariablesProcessor extends BaseProcessor {
  readonly name = 'PlaceholderVariablesProcessor';

  constructor(
    private config: PlaceholderVariablesConfig,
    options: ProcessorOptions = {},
  ) {
    super(options);
  }

  protected async doProcess(context: PipelineContext): Promise<PipelineContext> {
    const clonedContext = this.cloneContext(context);

    let processedCount = 0;
    const depth = this.config.depth ?? 2;

    log(
      `Starting placeholder variables processing with ${Object.keys(this.config.variableGenerators).length} generators`,
    );

    // Find the index of the last user message — only it and system messages get processed.
    // Historical messages were already expanded when originally sent; re-expanding
    // time-based variables ({{time}}, {{datetime}}, etc.) on every request would
    // break prompt-cache prefix stability for both Anthropic and OpenAI providers.
    let lastUserMessageIndex = -1;
    for (let i = clonedContext.messages.length - 1; i >= 0; i--) {
      if (clonedContext.messages[i].role === 'user') {
        lastUserMessageIndex = i;
        break;
      }
    }

    for (let i = 0; i < clonedContext.messages.length; i++) {
      const message = clonedContext.messages[i];

      const isSystem = message.role === 'system';
      const isLastUserMessage = i === lastUserMessageIndex;
      if (!isSystem && !isLastUserMessage) continue;

      try {
        const originalMessage = JSON.stringify(message);
        const processedMessage = this.processMessagePlaceholders(message, depth, isSystem);

        if (JSON.stringify(processedMessage) !== originalMessage) {
          clonedContext.messages[i] = processedMessage;
          processedCount++;
          log(`Processed placeholders in message ${message.id}, role: ${message.role}`);
        }
      } catch (error) {
        log.extend('error')(`Error processing placeholders in message ${message.id}: ${error}`);
      }
    }

    clonedContext.metadata.placeholderVariablesProcessed = processedCount;

    log(`Placeholder variables processing completed, processed ${processedCount} messages`);

    return this.markAsExecuted(clonedContext);
  }

  /**
   * 处理单个消息的占位符变量
   *
   * @param message 消息对象
   * @param depth 递归深度
   * @param isSystem 是否为系统消息 — 当 provider 为 `openaicompatible` 时，
   *   系统消息会跳过 volatile 生成器以保持 prompt-cache 前缀稳定。
   */
  private processMessagePlaceholders(message: any, depth: number, isSystem = false): any {
    if (!message?.content) return message;

    const { content } = message;

    // For `openaicompatible` system messages, filter out volatile generators
    // (time, random, uuid, etc.) so the system prompt stays byte-stable across
    // requests and OpenAI prompt caching keeps hitting. All other providers and
    // message roles expand all placeholders as before.
    const generators =
      isSystem && this.config.provider === 'openaicompatible'
        ? Object.fromEntries(
            Object.entries(this.config.variableGenerators).filter(
              ([key]) => !VOLATILE_GENERATOR_KEYS.has(key),
            ),
          )
        : this.config.variableGenerators;

    // Handle string type directly
    if (typeof content === 'string') {
      return {
        ...message,
        content: parsePlaceholderVariables(content, generators, depth),
      };
    }

    // Handle array type by processing text elements
    if (Array.isArray(content)) {
      return {
        ...message,
        content: content.map((item) =>
          item?.type === 'text'
            ? {
                ...item,
                text: parsePlaceholderVariables(item.text, generators, depth),
              }
            : item,
        ),
      };
    }

    return message;
  }
}
