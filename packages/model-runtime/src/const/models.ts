export const systemToUserModels = new Set([
  'o1-preview',
  'o1-preview-2024-09-12',
  'o1-mini',
  'o1-mini-2024-09-12',
]);

// TODO: 临时写法，后续要重构成 model card 展示配置
export const disableStreamModels = new Set([
  'o1',
  'o1-2024-12-17',
  'o1-pro',
  'o1-pro-2025-03-19',
  /*
  官网显示不支持，但是实际试下来支持 Streaming，暂时注释掉
  'o3-pro',
  'o3-pro-2025-06-10',
  */
  'computer-use-preview',
  'computer-use-preview-2025-03-11',
  // OpenAI: GPT-5.5 Pro Features.Streaming = Not supported
  // https://developers.openai.com/api/docs/models/gpt-5.5-pro
  'gpt-5.5-pro',
  'gpt-5.5-pro-2026-04-23',
]);

/**
 * models use Responses API only
 */
export const responsesAPIModels = new Set([
  'o1-pro',
  'o1-pro-2025-03-19',
  'o3-deep-research',
  'o3-deep-research-2025-06-26',
  'o3-pro',
  'o3-pro-2025-06-10',
  'o4-mini-deep-research',
  'o4-mini-deep-research-2025-06-26',
  'codex-mini-latest',
  'computer-use-preview',
  'computer-use-preview-2025-03-11',
  'gpt-5-codex',
  'gpt-5-pro',
  'gpt-5-pro-2025-10-06',
  'gpt-5.5',
  'gpt-5.5-2026-04-23',
  // Pro cards: Responses only. GPT-5.5 Pro also rejects streaming.
  // https://developers.openai.com/api/docs/models/gpt-5.5-pro
  // https://developers.openai.com/api/docs/models/gpt-5.4-pro
  // https://developers.openai.com/api/docs/models/gpt-5.2-pro
  'gpt-5.5-pro',
  'gpt-5.5-pro-2026-04-23',
  'gpt-5.4-pro',
  'gpt-5.4-pro-2026-03-05',
  'gpt-5.2-pro',
  'gpt-5.2-pro-2025-12-11',
]);

/** Dated Pro snapshots keep the same alias prefix as the shipped card. */
export const isDisableStreamModel = (model: string): boolean =>
  disableStreamModels.has(model) || model.startsWith('gpt-5.5-pro');

export const isResponsesAPIOnlyModel = (model: string): boolean =>
  responsesAPIModels.has(model) ||
  model.startsWith('gpt-5.5-pro') ||
  model.startsWith('gpt-5.4-pro') ||
  model.startsWith('gpt-5.2-pro');

/**
 * models support context caching
 */
export const contextCachingModels = new Set([
  'claude-fable-5-1',
  'claude-opus-5',
  'claude-sonnet-5',
  'claude-opus-4-8',
  'claude-opus-4-7',
  'claude-opus-4-6',
  'claude-sonnet-4-6',
  'claude-opus-4-latest',
  'claude-opus-4-20250514',
  'claude-sonnet-4-latest',
  'claude-sonnet-4-20250514',
  'claude-3-7-sonnet-latest',
  'claude-3-7-sonnet-20250219',
  'claude-3-5-sonnet-latest',
  'claude-3-5-sonnet-20241022',
  'claude-3-5-sonnet-20240620',
  'claude-3-5-haiku-latest',
  'claude-3-5-haiku-20241022',
]);

export const thinkingWithToolClaudeModels = new Set([
  'claude-fable-5-1',
  'claude-opus-5',
  'claude-sonnet-5',
  'claude-opus-4-8',
  'claude-opus-4-7',
  'claude-opus-4-6',
  'claude-sonnet-4-6',
  'claude-opus-4-latest',
  'claude-opus-4-20250514',
  'claude-sonnet-4-latest',
  'claude-sonnet-4-20250514',
  'claude-3-7-sonnet-latest',
  'claude-3-7-sonnet-20250219',
]);
