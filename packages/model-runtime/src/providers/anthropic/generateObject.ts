import type Anthropic from '@anthropic-ai/sdk';
import debug from 'debug';

import { buildAnthropicMessages, buildAnthropicTools } from '../../core/contextBuilders/anthropic';
import { GenerateObjectOptions, GenerateObjectPayload } from '../../types';
import { anthropicNoForcedToolChoiceModels } from './thinkingCapabilities';

const log = debug('lobe-model-runtime:anthropic:generate-object');

/**
 * With `tool_choice: auto` the model may answer in text instead of calling the
 * tool; Anthropic says to state in the prompt that it must use the tool.
 * https://platform.claude.com/docs/en/models/sonnet-5-5/migration-guide
 */
const TOOL_ONLY_INSTRUCTION =
  'Respond only with tool calls to the provided tools; do not reply with plain text.';

/** Strict tool use requires `additionalProperties: false` on every object schema. */
const toStrictSchema = (schema: any): any => {
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) return schema;

  const next = { ...schema };
  if (next.properties) {
    next.properties = Object.fromEntries(
      Object.entries(next.properties).map(([key, value]) => [key, toStrictSchema(value)]),
    );
  }
  if (next.items) next.items = toStrictSchema(next.items);
  for (const key of ['anyOf', 'allOf'] as const) {
    if (Array.isArray(next[key])) next[key] = next[key].map(toStrictSchema);
  }
  for (const key of ['$defs', 'definitions'] as const) {
    if (next[key]) {
      next[key] = Object.fromEntries(
        Object.entries(next[key]).map(([name, value]) => [name, toStrictSchema(value)]),
      );
    }
  }
  if (next.type === 'object' || next.properties) next.additionalProperties = false;

  return next;
};

/**
 * Generate structured output using Anthropic Claude API with Function Calling
 */
export const createAnthropicGenerateObject = async (
  client: Anthropic,
  payload: GenerateObjectPayload,
  options?: GenerateObjectOptions,
) => {
  const { schema, messages, model, tools } = payload;
  const avoidForcedToolChoice = anthropicNoForcedToolChoiceModels.has(model);

  log('generateObject called with model: %s', model);
  log('schema: %O', schema);
  log('messages count: %d', messages.length);

  // Convert messages to Anthropic format
  const system_message = messages.find((m) => m.role === 'system')?.content;
  const user_messages = messages.filter((m) => m.role !== 'system');
  const anthropicMessages = await buildAnthropicMessages(user_messages);

  log('converted %d messages to Anthropic format', anthropicMessages.length);

  const systemPrompts = [
    ...(system_message ? [{ text: system_message, type: 'text' as const }] : []),
    ...(avoidForcedToolChoice ? [{ text: TOOL_ONLY_INSTRUCTION, type: 'text' as const }] : []),
  ];

  let finalTools;
  let schemaToolName: string | undefined;
  if (tools) {
    finalTools = buildAnthropicTools(tools);
  } else if (schema) {
    // Convert OpenAI-style schema to Anthropic tool format
    const tool = {
      description:
        schema.description || 'Generate structured output according to the provided schema',
      input_schema: (avoidForcedToolChoice ? toStrictSchema(schema.schema) : schema.schema) as any,
      name: schema.name || 'structured_output',
      ...(avoidForcedToolChoice ? { strict: true } : {}),
    } as Anthropic.ToolUnion;
    log('converted tool: %O', tool);

    finalTools = [tool];
    schemaToolName = tool.name;
  } else {
    throw new Error('tools or schema is required');
  }

  let tool_choice: Anthropic.ToolChoice;
  if (avoidForcedToolChoice) {
    tool_choice = { type: 'auto' };
  } else if (schemaToolName) {
    tool_choice = { name: schemaToolName, type: 'tool' };
  } else {
    tool_choice = { type: 'any' };
  }

  // Adaptive thinking is always on for these models and shares `max_tokens`.
  const maxTokens = avoidForcedToolChoice ? 16_000 : 8192;

  try {
    log('calling Anthropic API with max_tokens: %d', maxTokens);

    const requestPayload = {
      max_tokens: maxTokens,
      messages: anthropicMessages,
      model,
      ...(avoidForcedToolChoice ? { output_config: { effort: 'low' as const } } : {}),
      system: systemPrompts.length > 0 ? systemPrompts : undefined,
      tool_choice: tool_choice,
      tools: finalTools,
    };
    await options?.onRequestPrepared?.(requestPayload, { apiMode: 'messages' });
    const response = await client.messages.create(
      requestPayload,
      { signal: options?.signal },
    );

    log('received response with %d content blocks', response.content.length);
    log('response: %O', response);

    // Extract the tool use result
    if (schemaToolName) {
      const toolUseBlock = response.content.find(
        (block) => block.type === 'tool_use' && block.name === schemaToolName,
      );

      if (!toolUseBlock || toolUseBlock.type !== 'tool_use') {
        log('no tool use found in response (expected tool: %s)', schemaToolName);
        return undefined;
      }

      log('extracted tool input: %O', toolUseBlock.input);
      return toolUseBlock.input;
    }

    return response.content
      .filter((block) => block.type === 'tool_use')
      .map((block) => ({ arguments: block.input, name: block.name }));
  } catch (error) {
    log('generateObject error: %O', error);
    throw error;
  }
};
