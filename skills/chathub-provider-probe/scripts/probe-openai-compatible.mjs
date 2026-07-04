#!/usr/bin/env node

import crypto from 'node:crypto';

const DEFAULT_MODEL = 'gpt-5.5';
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_CACHE_RUNS = 6;
const DEFAULT_RESPONSE_CACHE_STRATEGIES = [
  'prompt-key-session-header',
  'implicit-derived-key',
  'prompt-key-store-default',
  'prompt-key-store-true',
  'prompt-key-store-false',
  'session-header-only',
  'codex-client-metadata',
  'previous-response',
];
const LATE_RESPONSE_CACHE_STRATEGIES = ['cache-control-content-blocks'];
const DEFAULT_CHAT_CACHE_STRATEGIES = [
  'chat-session-header-prompt-cache-key',
  'chat-session-header',
  'chat-prompt-cache-key',
  'chat-repeat',
];
const LATE_CHAT_CACHE_STRATEGIES = ['chat-cache-control-content'];

const args = parseArgs(process.argv.slice(2));
const phase = args.phase || 'baseline';
const apiKey = process.env.PROBE_OPENAICOMPATIBLE_API_KEY || '';
const rawBaseURL = process.env.PROBE_OPENAICOMPATIBLE_PROXY_URL || '';
const baseURL = trimTrailingSlash(rawBaseURL.trim());
const model = args.model || process.env.PROBE_OPENAICOMPATIBLE_MODEL || DEFAULT_MODEL;
const timeoutMs = numberArg(args.timeoutMs, DEFAULT_TIMEOUT_MS);
const probeNonce = `${Date.now().toString(36)}_${crypto.randomBytes(3).toString('hex')}`;

if (!apiKey || !baseURL) {
  console.error(
    JSON.stringify(
      {
        error:
          'Missing PROBE_OPENAICOMPATIBLE_API_KEY or PROBE_OPENAICOMPATIBLE_PROXY_URL.',
        requiredEnv: [
          'PROBE_OPENAICOMPATIBLE_API_KEY',
          'PROBE_OPENAICOMPATIBLE_PROXY_URL',
        ],
      },
      null,
      2,
    ),
  );
  process.exit(2);
}

const report = {
  baseURL,
  diagnosis: {
    baseUrlAdvice: baseURL.endsWith('/v1')
      ? 'Base URL includes /v1.'
      : 'Base URL does not end with /v1; many OpenAI-compatible gateways require it.',
    chatCompletionsWorks: false,
    discrepancies: [],
    keyWorks: false,
    responsesWorks: false,
  },
  model,
  phase,
  results: [],
  startedAt: new Date().toISOString(),
};

try {
  if (phase === 'baseline') await runBaseline();
  else if (phase === 'params') await runParams();
  else if (phase === 'cache-key') await runCacheKey(args.strategy || 'prompt-key-session-header');
  else if (phase === 'cache-previous-response') await runPreviousResponse();
  else if (phase === 'cache-chat-repeat') await runChatRepeat(args.strategy || 'chat-repeat');
  else if (phase === 'cache-both') await runCacheBoth();
  else if (phase === 'cache-round') await runCacheRound();
  else if (phase === 'cache-matrix') await runCacheMatrix();
  else if (phase === 'all') {
    await runBaseline();
    await runParams();
  } else {
    throw new Error(`Unknown --phase ${phase}`);
  }

  finalizeDiagnosis(report);
  report.providerReport = buildProviderReport(report);
  report.finishedAt = new Date().toISOString();
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  report.fatal = {
    message: error?.message || String(error),
    name: error?.name,
  };
  report.finishedAt = new Date().toISOString();
  console.log(JSON.stringify(report, null, 2));
  process.exit(1);
}

async function runBaseline() {
  await record('models.list', () => request('/models', { method: 'GET' }));
  await record('chat.minimal', () =>
    request('/chat/completions', {
      body: {
        messages: [{ content: 'Say exactly: ok', role: 'user' }],
        model,
        stream: false,
      },
      method: 'POST',
    }),
  );
  await record('responses.stream', () =>
    request('/responses', {
      body: {
        input: [{ content: 'Say exactly: ok', role: 'user' }],
        model,
        store: false,
        stream: true,
      },
      method: 'POST',
    }),
  );
  await record('responses.omitStreamFlag', () =>
    request('/responses', {
      body: {
        input: [{ content: 'Say exactly: ok', role: 'user' }],
        model,
        store: false,
      },
      method: 'POST',
    }),
  );
}

async function runParams() {
  const responseBase = {
    input: [{ content: 'Say exactly: ok', role: 'user' }],
    model,
    store: false,
    stream: true,
  };

  await record('chat.max_tokens', () =>
    request('/chat/completions', {
      body: {
        max_tokens: 16,
        messages: [{ content: 'Say exactly: ok', role: 'user' }],
        model,
        stream: false,
      },
      method: 'POST',
    }),
  );
  await record('chat.reasoning_effort', () =>
    request('/chat/completions', {
      body: {
        messages: [{ content: 'Say exactly: ok', role: 'user' }],
        model,
        reasoning_effort: 'low',
        stream: false,
      },
      method: 'POST',
    }),
  );
  await record('responses.max_tokens', () =>
    request('/responses', {
      body: { ...responseBase, max_tokens: 16 },
      method: 'POST',
    }),
  );
  await record('responses.max_output_tokens', () =>
    request('/responses', {
      body: { ...responseBase, max_output_tokens: 16 },
      method: 'POST',
    }),
  );
  await record('responses.reasoning.low', () =>
    request('/responses', {
      body: { ...responseBase, reasoning: { effort: 'low' } },
      method: 'POST',
    }),
  );
  await record('responses.verbosity.topLevel', () =>
    request('/responses', {
      body: { ...responseBase, verbosity: 'low' },
      method: 'POST',
    }),
  );
  await record('responses.verbosity.textObject', () =>
    request('/responses', {
      body: { ...responseBase, text: { verbosity: 'low' } },
      method: 'POST',
    }),
  );
  await record('responses.verbosity.both', () =>
    request('/responses', {
      body: { ...responseBase, text: { verbosity: 'low' }, verbosity: 'low' },
      method: 'POST',
    }),
  );
  await record('responses.truncation.auto', () =>
    request('/responses', {
      body: { ...responseBase, truncation: 'auto' },
      method: 'POST',
    }),
  );
  await record('responses.truncation.disabled', () =>
    request('/responses', {
      body: { ...responseBase, truncation: 'disabled' },
      method: 'POST',
    }),
  );
}

async function runCacheBoth() {
  const responseStrategy = args.responseStrategy || args.strategy || 'prompt-key-session-header';
  const chatStrategy = args.chatStrategy || 'chat-session-header';
  const responseCacheKey = args.responseCacheKey || cacheBothKey('responses');
  const chatCacheKey = args.chatCacheKey || cacheBothKey('chat-completions');

  const responseSummary = await runCacheKey(responseStrategy, {
    promptCacheKey: responseCacheKey,
    skipReportSummary: true,
  });
  const chatSummary = await runChatRepeat(chatStrategy, {
    promptCacheKey: chatCacheKey,
    skipReportSummary: true,
  });

  report.cacheSummary = {
    chatCompletions: chatSummary,
    comparison: summarizeCacheComparison(responseSummary, chatSummary),
    responses: responseSummary,
  };
}

async function runCacheRound() {
  const endpointScope = args.endpoint || args.matrixEndpoint || 'both';
  const confirmedResponseStrategy = stringArg(args.confirmedResponseStrategy);
  const confirmedChatStrategy = stringArg(args.confirmedChatStrategy);
  const responseStrategy = args.responseStrategy || args.strategy || 'prompt-key-session-header';
  const chatStrategy =
    args.chatStrategy ||
    (['chat', 'chat-completions', 'chatCompletions'].includes(endpointScope) && args.strategy
      ? args.strategy
      : 'chat-session-header-prompt-cache-key');
  const responseCacheKey = args.responseCacheKey || cacheBothKey(`round-responses-${responseStrategy}`);
  const chatCacheKey = args.chatCacheKey || cacheBothKey(`round-chat-completions-${chatStrategy}`);
  const testResponses =
    ['both', 'responses', 'response'].includes(endpointScope) && !confirmedResponseStrategy;
  const testChat =
    ['both', 'chat', 'chat-completions', 'chatCompletions'].includes(endpointScope) &&
    !confirmedChatStrategy;

  const responseSummary =
    confirmedResponseStrategy
      ? confirmedCacheSummary('/responses', confirmedResponseStrategy)
      : testResponses
        ? await runResponseCacheStrategy(responseStrategy, {
            promptCacheKey: responseCacheKey,
            skipReportSummary: true,
          })
        : null;
  const chatSummary =
    confirmedChatStrategy
      ? confirmedCacheSummary('/chat/completions', confirmedChatStrategy)
      : testChat
        ? await runChatRepeat(chatStrategy, {
            promptCacheKey: chatCacheKey,
            skipReportSummary: true,
          })
        : null;

  report.cacheSummary = {
    chatCompletions: chatSummary,
    comparison: summarizeCacheComparison(responseSummary, chatSummary),
    responses: responseSummary,
    round: summarizeCacheRound({
      chatStrategy,
      confirmedChatStrategy,
      confirmedResponseStrategy,
      endpointScope,
      responseStrategy,
      testChat,
      testResponses,
    }),
  };
}

async function runCacheMatrix() {
  const endpointScope = args.endpoint || args.matrixEndpoint || 'both';
  const includeLateStrategies =
    args.includeLateStrategies === true ||
    args.includeLateStrategies === 'true' ||
    args.matrixMode === 'full' ||
    args.matrixMode === 'all';
  const responseStrategies = parseListArg(args.responseStrategies, [
    ...DEFAULT_RESPONSE_CACHE_STRATEGIES,
    ...(includeLateStrategies ? LATE_RESPONSE_CACHE_STRATEGIES : []),
  ]);
  const chatStrategies = parseListArg(args.chatStrategies, [
    ...DEFAULT_CHAT_CACHE_STRATEGIES,
    ...(includeLateStrategies ? LATE_CHAT_CACHE_STRATEGIES : []),
  ]);
  const confirmedResponseStrategy = stringArg(args.confirmedResponseStrategy);
  const confirmedChatStrategy = stringArg(args.confirmedChatStrategy);
  const testResponses =
    ['both', 'responses', 'response'].includes(endpointScope) && !confirmedResponseStrategy;
  const testChat =
    ['both', 'chat', 'chat-completions', 'chatCompletions'].includes(endpointScope) &&
    !confirmedChatStrategy;
  const responseSummaries = [];
  const chatSummaries = [];

  if (testResponses) {
    for (const strategy of responseStrategies) {
      responseSummaries.push(
        await safeRunCacheMatrixStrategy({
          endpoint: '/responses',
          runner: () =>
            strategy === 'previous-response'
              ? runPreviousResponse({ skipReportSummary: true })
              : runCacheKey(strategy, { skipReportSummary: true }),
          strategy,
        }),
      );
    }
  }

  if (testChat) {
    for (const strategy of chatStrategies) {
      chatSummaries.push(
        await safeRunCacheMatrixStrategy({
          endpoint: '/chat/completions',
          runner: () => runChatRepeat(strategy, { skipReportSummary: true }),
          strategy,
        }),
      );
    }
  }

  const responseSummary =
    confirmedResponseStrategy
      ? confirmedCacheSummary('/responses', confirmedResponseStrategy)
      : bestCacheSummary(responseSummaries);
  const chatSummary =
    confirmedChatStrategy
      ? confirmedCacheSummary('/chat/completions', confirmedChatStrategy)
      : bestCacheSummary(chatSummaries);

  report.cacheSummary = {
    chatCompletions: chatSummary,
    comparison: summarizeCacheComparison(responseSummary, chatSummary),
    matrix: summarizeCacheMatrix({
      chatStrategies,
      chatSummaries,
      confirmedChatStrategy,
      confirmedResponseStrategy,
      endpointScope,
      includeLateStrategies,
      responseStrategies,
      responseSummaries,
      testChat,
      testResponses,
    }),
    responses: responseSummary,
  };
}

async function safeRunCacheMatrixStrategy({ endpoint, runner, strategy }) {
  try {
    return await runner();
  } catch (error) {
    return {
      endpoint,
      fatal: {
        message: error?.message || String(error),
        name: error?.name,
      },
      likelyHit: false,
      note:
        'Strategy failed before a complete cache summary was available. Retry once before treating this as a provider rejection.',
      rounds: [],
      strategy,
    };
  }
}

async function runCacheKey(strategy, options = {}) {
  return runResponseCacheStrategy(strategy, options);
}

async function runResponseCacheStrategy(strategy, options = {}) {
  const promptCacheKey =
    options.promptCacheKey || args.cacheKey || scopedCacheKey('responses');
  const strategyConfig = responseCacheStrategy(strategy, promptCacheKey);
  const runs = numberArg(args.runs, DEFAULT_CACHE_RUNS);
  const pauseMs = numberArg(args.pauseMs, 2_000);
  const results = [];

  for (let i = 0; i < runs; i += 1) {
    const body = {
      input: cacheInput(i, { cacheControlBlocks: strategyConfig.cacheControlBlocks }),
      model,
      reasoning: { effort: 'low' },
      store: strategyConfig.store,
      stream: true,
    };
    if (strategyConfig.includePromptCacheKey) body.prompt_cache_key = promptCacheKey;
    if (strategyConfig.clientMetadata) body.client_metadata = strategyConfig.clientMetadata;
    const result = await record(`cache.${strategy}.round${i + 1}`, () =>
      request('/responses', { body, headers: strategyConfig.headers, method: 'POST' }),
    );
    results.push(result);
    if (i + 1 < runs) await sleep(pauseMs);
  }

  const summary = summarizeCacheResults(strategy, results, {
    endpoint: '/responses',
    promptCacheKey,
    strategyDescription: strategyConfig.description,
    store: strategyConfig.store,
  });
  if (!options.skipReportSummary) report.cacheSummary = summary;
  return summary;
}

async function runPreviousResponse(options = {}) {
  const first = await record('cache.previousResponse.round1', () =>
    request('/responses', {
      body: {
        input: cacheInput(0),
        model,
        reasoning: { effort: 'low' },
        store: true,
        stream: true,
      },
      method: 'POST',
    }),
  );

  const previousResponseId = first.responseId;
  if (!previousResponseId) {
    const summary = {
      endpoint: '/responses',
      likelyHit: false,
      note: 'First response did not expose a response id; cannot test previous_response_id.',
      rounds: [cacheRoundSummary(first)],
      strategy: 'previous-response',
    };
    if (!options.skipReportSummary) report.cacheSummary = summary;
    return summary;
  }

  await sleep(numberArg(args.pauseMs, 1_500));

  const second = await record('cache.previousResponse.round2', () =>
    request('/responses', {
      body: {
        input: [{ content: 'Follow up. Say exactly: ok', role: 'user' }],
        model,
        previous_response_id: previousResponseId,
        store: true,
        stream: true,
      },
      method: 'POST',
    }),
  );

  const summary = summarizeCacheResults('previous-response', [first, second], {
    endpoint: '/responses',
    previousResponseId,
    strategyDescription: 'Provider-managed response state through previous_response_id.',
  });
  if (!options.skipReportSummary) report.cacheSummary = summary;
  return summary;
}

async function runChatRepeat(strategy, options = {}) {
  const promptCacheKey =
    options.promptCacheKey || args.cacheKey || scopedCacheKey('chat-completions');
  const strategyConfig = chatCacheStrategy(strategy, promptCacheKey);
  const runs = numberArg(args.runs, DEFAULT_CACHE_RUNS);
  const pauseMs = numberArg(args.pauseMs, 2_000);
  const results = [];

  for (let i = 0; i < runs; i += 1) {
    const body = {
      messages: chatCacheMessages(i, { cacheControlBlocks: strategyConfig.cacheControlBlocks }),
      model,
      stream: false,
    };
    if (strategyConfig.includePromptCacheKey) body.prompt_cache_key = promptCacheKey;
    const result = await record(`cache.${strategy}.round${i + 1}`, () =>
      request('/chat/completions', {
        body,
        headers: strategyConfig.headers,
        method: 'POST',
      }),
    );
    results.push(result);
    if (i + 1 < runs) await sleep(pauseMs);
  }

  const summary = summarizeCacheResults(strategy, results, {
    endpoint: '/chat/completions',
    promptCacheKey,
    strategyDescription: strategyConfig.description,
  });
  if (!options.skipReportSummary) report.cacheSummary = summary;
  return summary;
}

async function record(name, fn) {
  const startedAt = Date.now();
  const result = await fn();
  const entry = {
    durationMs: Date.now() - startedAt,
    name,
    ...result,
  };
  report.results.push(entry);
  return entry;
}

async function request(path, { body, headers: extraHeaders = {}, method }) {
  const headers = {
    Authorization: `Bearer ${apiKey}`,
    ...extraHeaders,
  };
  let requestBody;
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    requestBody = JSON.stringify(body);
  }

  const response = await fetch(`${baseURL}${path}`, {
    body: requestBody,
    headers,
    method,
    signal: AbortSignal.timeout(timeoutMs),
  });

  const raw = await response.text();
  const contentType = response.headers.get('content-type') || '';
  const parsed = parseResponseBody(raw, contentType);
  const finalResponse = extractFinalResponse(parsed);
  const usage = extractUsage(parsed, finalResponse);
  const cacheSignals = extractCacheSignals(usage, parsed, finalResponse);
  const cachedTokens = cacheSignals.cacheReadTokens;

  return {
    cacheSignals,
    cachedTokens,
    contentType,
    diagnosticHeaders: extractDiagnosticHeaders(response.headers),
    errorDetail: extractErrorDetail(parsed, raw),
    eventTypes: parsed.events.map((event) => event.event || event.data?.type).filter(Boolean),
    ok: response.ok,
    object: parsed.json?.object || finalResponse?.object,
    path,
    requestId:
      response.headers.get('x-request-id') || response.headers.get('x-client-request-id') || null,
    responseId: extractResponseId(parsed, finalResponse),
    status: response.status,
    textSample: extractTextSample(parsed, raw),
    usage,
  };
}

function parseResponseBody(raw, contentType) {
  const isSSE = contentType.includes('text/event-stream') || raw.trimStart().startsWith('event:');
  if (isSSE) return { events: parseSSE(raw), json: null, rawSnippet: snippet(raw) };

  try {
    return { events: [], json: JSON.parse(raw), rawSnippet: snippet(raw) };
  } catch {
    return { events: [], json: null, rawSnippet: snippet(raw) };
  }
}

function parseSSE(raw) {
  const events = [];
  const blocks = raw.replaceAll('\r\n', '\n').split(/\n\n+/);

  for (const block of blocks) {
    const lines = block.split('\n').filter(Boolean);
    if (!lines.length) continue;

    let eventName = '';
    const dataLines = [];
    for (const line of lines) {
      if (line.startsWith('event:')) eventName = line.slice(6).trim();
      if (line.startsWith('data:')) dataLines.push(line.slice(5).trimStart());
    }

    const dataRaw = dataLines.join('\n');
    if (!dataRaw || dataRaw === '[DONE]') {
      events.push({ data: dataRaw, event: eventName });
      continue;
    }

    let data;
    try {
      data = JSON.parse(dataRaw);
    } catch {
      data = dataRaw;
    }
    events.push({ data, event: eventName });
  }

  return events;
}

function extractFinalResponse(parsed) {
  if (parsed.json?.object === 'response') return parsed.json;
  if (parsed.json?.response?.object === 'response') return parsed.json.response;

  for (let i = parsed.events.length - 1; i >= 0; i -= 1) {
    const data = parsed.events[i].data;
    if (data?.type === 'response.completed' && data.response) return data.response;
    if (data?.response?.object === 'response') return data.response;
  }

  return null;
}

function extractUsage(parsed, finalResponse) {
  return collectUsageObjects(parsed, finalResponse)[0]?.value || null;
}

function extractCacheSignals(usage, parsed, finalResponse) {
  const candidates = [];
  const usageObjects = collectUsageObjects(parsed, finalResponse);
  if (usage && !usageObjects.some((entry) => entry.value === usage)) {
    usageObjects.unshift({ path: 'selected.usage', value: usage });
  }

  const usageReadPaths = [
    'cache_read_input_tokens',
    'cacheReadInputTokens',
    'input_tokens_details.cached_tokens',
    'inputTokensDetails.cachedTokens',
    'prompt_tokens_details.cached_tokens',
    'promptTokensDetails.cachedTokens',
    'cached_tokens',
    'cachedTokens',
    'prompt_cache_hit_tokens',
    'promptCacheHitTokens',
    'cachedContentTokenCount',
    'usageMetadata.cachedContentTokenCount',
    'usage_metadata.cachedContentTokenCount',
    'usage_metadata.cached_content_token_count',
  ];
  const usageCreationPaths = [
    'cache_creation_input_tokens',
    'cacheCreationInputTokens',
    'input_tokens_details.cached_creation_tokens',
    'inputTokensDetails.cachedCreationTokens',
    'prompt_tokens_details.cached_creation_tokens',
    'promptTokensDetails.cachedCreationTokens',
    'cached_creation_tokens',
    'cachedCreationTokens',
    'cache_creation_tokens',
    'cacheCreationTokens',
  ];
  const usageMissPaths = [
    'prompt_cache_miss_tokens',
    'promptCacheMissTokens',
    'cache_miss_input_tokens',
    'cacheMissInputTokens',
  ];

  for (const entry of usageObjects) {
    for (const path of usageReadPaths) {
      addSignalCandidate(candidates, 'cacheReadTokens', `${entry.path}.${path}`, readPath(entry.value, path));
    }
    for (const path of usageCreationPaths) {
      addSignalCandidate(
        candidates,
        'cacheCreationTokens',
        `${entry.path}.${path}`,
        readPath(entry.value, path),
      );
    }
    for (const path of usageMissPaths) {
      addSignalCandidate(candidates, 'cacheMissTokens', `${entry.path}.${path}`, readPath(entry.value, path));
    }
  }

  const topLevelRoots = [
    { path: 'json', value: parsed.json },
    { path: 'finalResponse', value: finalResponse },
  ];
  for (const entry of topLevelRoots) {
    addSignalCandidate(
      candidates,
      'cacheReadTokens',
      `${entry.path}.input_tokens_details.cached_tokens`,
      readPath(entry.value, 'input_tokens_details.cached_tokens'),
    );
    addSignalCandidate(
      candidates,
      'cacheReadTokens',
      `${entry.path}.inputTokensDetails.cachedTokens`,
      readPath(entry.value, 'inputTokensDetails.cachedTokens'),
    );
    addSignalCandidate(
      candidates,
      'cacheReadTokens',
      `${entry.path}.prompt_tokens_details.cached_tokens`,
      readPath(entry.value, 'prompt_tokens_details.cached_tokens'),
    );
    addSignalCandidate(
      candidates,
      'cacheReadTokens',
      `${entry.path}.promptTokensDetails.cachedTokens`,
      readPath(entry.value, 'promptTokensDetails.cachedTokens'),
    );
    addSignalCandidate(
      candidates,
      'cacheReadTokens',
      `${entry.path}.usageMetadata.cachedContentTokenCount`,
      readPath(entry.value, 'usageMetadata.cachedContentTokenCount'),
    );
    addSignalCandidate(
      candidates,
      'cacheReadTokens',
      `${entry.path}.usage_metadata.cachedContentTokenCount`,
      readPath(entry.value, 'usage_metadata.cachedContentTokenCount'),
    );
  }
  addSignalCandidate(candidates, 'cacheReadTokens', 'json.timings.cache_n', parsed.json?.timings?.cache_n);

  return {
    cacheCreationTokens: selectSignal(candidates, 'cacheCreationTokens'),
    cacheMissTokens: selectSignal(candidates, 'cacheMissTokens'),
    cacheReadTokens: selectSignal(candidates, 'cacheReadTokens'),
    candidates,
  };
}

function collectUsageObjects(parsed, finalResponse) {
  const entries = [];
  addObjectEntry(entries, 'finalResponse.usage', finalResponse?.usage);
  addObjectEntry(entries, 'json.usage', parsed.json?.usage);
  addObjectEntry(entries, 'json.response.usage', parsed.json?.response?.usage);
  addObjectEntry(entries, 'json.message.usage', parsed.json?.message?.usage);
  if (Array.isArray(parsed.json?.choices)) {
    parsed.json.choices.forEach((choice, index) => {
      addObjectEntry(entries, `json.choices.${index}.usage`, choice?.usage);
    });
  }

  parsed.events.forEach((event, index) => {
    const data = event.data;
    addObjectEntry(entries, `events.${index}.data.usage`, data?.usage);
    addObjectEntry(entries, `events.${index}.data.message.usage`, data?.message?.usage);
    addObjectEntry(entries, `events.${index}.data.response.usage`, data?.response?.usage);
    addObjectEntry(entries, `events.${index}.data.delta.usage`, data?.delta?.usage);
  });

  return entries;
}

function addObjectEntry(entries, path, value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) entries.push({ path, value });
}

function addSignalCandidate(candidates, kind, path, value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return;
  candidates.push({ kind, path, value: Math.trunc(n) });
}

function selectSignal(candidates, kind) {
  const matches = candidates.filter((candidate) => candidate.kind === kind);
  const positive = matches.find((candidate) => candidate.value > 0);
  if (positive) return positive.value;
  const zero = matches.find((candidate) => candidate.value === 0);
  return zero ? 0 : null;
}

function readPath(value, path) {
  return path.split('.').reduce((current, part) => current?.[part], value);
}

function extractDiagnosticHeaders(headers) {
  const names = [
    'cf-cache-status',
    'openai-processing-ms',
    'x-cache',
    'x-client-request-id',
    'x-litellm-cache-hit',
    'x-litellm-call-id',
    'x-new-api-cache-hit',
    'x-ratelimit-remaining-requests',
    'x-ratelimit-remaining-tokens',
    'x-request-id',
  ];
  const result = {};
  for (const name of names) {
    const value = headers.get(name);
    if (value) result[name] = value;
  }
  return result;
}

function extractResponseId(parsed, finalResponse) {
  if (finalResponse?.id) return finalResponse.id;
  if (parsed.json?.id) return parsed.json.id;
  return null;
}

function extractTextSample(parsed, raw) {
  if (parsed.json?.choices?.[0]?.message?.content) return parsed.json.choices[0].message.content;
  if (parsed.json?.output_text) return parsed.json.output_text;

  const deltas = [];
  for (const event of parsed.events) {
    const data = event.data;
    if (data?.type === 'response.output_text.delta') deltas.push(data.delta || '');
    if (data?.type === 'response.output_text.done' && data.text && deltas.length === 0)
      deltas.push(data.text);
  }
  if (deltas.length > 0) return deltas.join('').slice(0, 200);

  return snippet(raw, 300);
}

function extractErrorDetail(parsed, raw) {
  return (
    parsed.json?.detail ||
    parsed.json?.error?.message ||
    parsed.json?.message ||
    (!parsed.json && raw.includes('<html') ? 'HTML response body' : null)
  );
}

function finalizeDiagnosis(currentReport) {
  const byName = Object.fromEntries(currentReport.results.map((result) => [result.name, result]));
  const models = byName['models.list'];
  const chat = byName['chat.minimal'];
  const responses = byName['responses.stream'];
  const anyChat = currentReport.results.some((result) => result.path === '/chat/completions' && result.ok);
  const anyResponses = currentReport.results.some((result) => result.path === '/responses' && result.ok);

  currentReport.diagnosis.keyWorks = Boolean(
    models?.ok || chat?.ok || responses?.ok || currentReport.results.some((r) => r.status === 200),
  );
  currentReport.diagnosis.chatCompletionsWorks = Boolean(chat?.ok || anyChat);
  currentReport.diagnosis.responsesWorks = Boolean(responses?.ok || anyResponses);

  if (!baseURL.endsWith('/v1')) {
    currentReport.diagnosis.discrepancies.push(
      'Configured base URL does not end with /v1; ChatHub will call routes relative to this exact base URL.',
    );
  }

  const omitStream = byName['responses.omitStreamFlag'];
  if (omitStream?.ok && omitStream.contentType.includes('text/event-stream')) {
    currentReport.diagnosis.discrepancies.push(
      'Responses returns text/event-stream when stream is omitted; keep ChatHub streaming enabled for this provider.',
    );
  }

  const maxTokens = byName['responses.max_tokens'];
  if (maxTokens && !maxTokens.ok) {
    currentReport.diagnosis.discrepancies.push(
      `Responses rejects max_tokens: ${maxTokens.errorDetail || maxTokens.status}.`,
    );
  }

  const topVerbosity = byName['responses.verbosity.topLevel'];
  const textVerbosity = byName['responses.verbosity.textObject'];
  if (topVerbosity && !topVerbosity.ok && textVerbosity?.ok) {
    currentReport.diagnosis.discrepancies.push(
      'Responses rejects top-level verbosity but accepts text.verbosity; this provider requires verbosity under text.',
    );
  }

  const truncation = byName['responses.truncation.auto'];
  if (truncation && !truncation.ok) {
    currentReport.diagnosis.discrepancies.push(
      `Responses rejects truncation: ${truncation.errorDetail || truncation.status}.`,
    );
  }
}

function buildProviderReport(currentReport) {
  const apiBehavior = {
    chatCompletions: buildEndpointReport(currentReport, {
      endpoint: '/chat/completions',
      label: 'Chat Completions',
    }),
    responses: buildEndpointReport(currentReport, {
      endpoint: '/responses',
      label: 'Responses API',
    }),
  };
  const cacheBehavior = buildCacheBehaviorReport(currentReport.cacheSummary);

  return {
    apiBehavior,
    cacheBehavior,
    recommendations: buildRecommendations(currentReport, apiBehavior, cacheBehavior),
    recommendedSettings: buildRecommendedSettings(currentReport, apiBehavior, cacheBehavior),
    summary: buildProviderSummary(currentReport, apiBehavior, cacheBehavior),
  };
}

function buildEndpointReport(currentReport, { endpoint, label }) {
  const results = currentReport.results.filter((result) => result.path === endpoint);
  const okResults = results.filter((result) => result.ok);
  const rejected = results
    .filter((result) => !result.ok)
    .map((result) => ({
      error: result.errorDetail || String(result.status),
      name: result.name,
      status: result.status,
    }));
  const cacheReadValues = results
    .map((result) => result.cacheSignals?.cacheReadTokens)
    .filter((value) => Number.isFinite(Number(value)));
  const usageCachePaths = unique(
    results.flatMap((result) =>
      (result.cacheSignals?.candidates || [])
        .filter((candidate) => candidate.kind === 'cacheReadTokens')
        .map((candidate) => candidate.path),
    ),
  );
  const notes = [];

  if (endpoint === '/responses') {
    const omitStream = currentReport.results.find((result) => result.name === 'responses.omitStreamFlag');
    if (omitStream?.ok && omitStream.contentType.includes('text/event-stream')) {
      notes.push('Streams SSE even when the stream flag is omitted.');
    }
    if (rejected.some((item) => item.name === 'responses.max_tokens')) {
      notes.push('Rejects Responses max_tokens.');
    }
    if (rejected.some((item) => item.name === 'responses.max_output_tokens')) {
      notes.push('Rejects Responses max_output_tokens.');
    }
    if (
      rejected.some((item) => item.name === 'responses.verbosity.topLevel') &&
      currentReport.results.some((result) => result.name === 'responses.verbosity.textObject' && result.ok)
    ) {
      notes.push('Requires text.verbosity instead of top-level verbosity.');
    }
  } else if (cacheReadValues.length === 0) {
    notes.push('No cache usage field was exposed by observed Chat Completions responses.');
  }

  return {
    acceptedCalls: okResults.map((result) => ({
      contentType: result.contentType,
      name: result.name,
      requestId: result.requestId,
      status: result.status,
    })),
    endpoint,
    label,
    notes,
    rejectedCalls: rejected,
    usageCachePaths,
    works: okResults.length > 0,
  };
}

function buildCacheBehaviorReport(cacheSummary) {
  if (!cacheSummary) {
    return {
      tested: false,
      interpretation: 'Cache behavior was not tested in this phase.',
    };
  }

  if (cacheSummary.responses || cacheSummary.chatCompletions) {
    const responses = buildEndpointCacheReport(cacheSummary.responses);
    const chatCompletions = buildEndpointCacheReport(cacheSummary.chatCompletions);
    return {
      chatCompletions,
      comparison: cacheSummary.comparison || summarizeCacheComparison(cacheSummary.responses, cacheSummary.chatCompletions),
      matrix: cacheSummary.matrix,
      round: cacheSummary.round,
      responses,
      tested: true,
    };
  }

  return {
    singleEndpoint: buildEndpointCacheReport(cacheSummary),
    tested: true,
  };
}

function buildEndpointCacheReport(summary) {
  if (!summary) {
    return {
      tested: false,
      interpretation: 'This endpoint cache strategy was not tested.',
    };
  }

  const rounds = summary.rounds || [];
  const hitStats = cacheHitStats(rounds);
  const stableAfterWarmup = summary.stableAfterWarmup ?? hitStats.stableAfterWarmup;
  const intermittentHit = summary.intermittentHit ?? hitStats.intermittentHit;
  const stability = summary.stability || hitStats.stability;

  return {
    confirmedByUser: Boolean(summary.confirmedByUser),
    endpoint: summary.endpoint || null,
    hitRate: summary.hitRate || hitStats.hitRate,
    hitRounds: hitStats.hitRounds,
    intermittentHit,
    interpretation: summary.confirmedByUser
      ? rounds.length === 0
        ? `${summary.endpoint || 'Endpoint'} cache strategy was confirmed by the user and was locked for this cache run.`
        : intermittentHit
          ? `${summary.endpoint || 'Endpoint'} cache mechanism was confirmed by the user, but hit behavior was intermittent (${summary.hitRate || hitStats.hitRate} later rounds).`
          : `${summary.endpoint || 'Endpoint'} cache strategy was confirmed by the user.`
      : summary.likelyHit
        ? intermittentHit
          ? `${summary.endpoint || 'Endpoint'} cache-read tokens were observed intermittently (${summary.hitRate || hitStats.hitRate} later rounds).`
          : `${summary.endpoint || 'Endpoint'} cache hit observed via cache-read usage fields.`
        : `${summary.endpoint || 'Endpoint'} did not expose later-round cache-read tokens in this run.`,
    likelyHit: Boolean(summary.likelyHit),
    maxCacheReadTokens: hitStats.maxCacheReadTokens,
    mechanism: describeCacheMechanism(summary),
    promptCacheKey: summary.promptCacheKey || null,
    requestIds: rounds.map((round) => round.requestId).filter(Boolean),
    stability,
    stableAfterWarmup,
    strategy: summary.strategy || null,
    tested: true,
  };
}

function describeCacheMechanism(summary) {
  const strategy = summary?.strategy || '';
  if (strategy === 'prompt-key-session-header') {
    return 'Stable Responses prompt_cache_key plus Session_id header with store:true.';
  }
  if (strategy === 'prompt-key-store-true') {
    return 'Stable Responses prompt_cache_key with store:true; this matches ChatHub response-state cache hints.';
  }
  if (strategy === 'prompt-key-store-default') {
    return 'Stable Responses prompt_cache_key with no store field; this matches ChatHub cache matrix store:default.';
  }
  if (strategy === 'prompt-key-store-false') {
    return 'Stable Responses prompt_cache_key with store:false; tests cache independent from stored response state.';
  }
  if (strategy === 'implicit-derived-key') {
    return 'Backend-derived key from stable model, reasoning, tools, system prompt, and first user turn.';
  }
  if (strategy === 'previous-response') {
    return 'Provider-managed response state through previous_response_id.';
  }
  if (strategy === 'chat-session-header') {
    return 'Repeated Chat Completions with a stable Session_id header and stable system prefix.';
  }
  if (strategy === 'chat-session-header-prompt-cache-key') {
    return 'Repeated Chat Completions with both a stable Session_id header and top-level prompt_cache_key.';
  }
  if (strategy === 'chat-prompt-cache-key') {
    return 'Repeated Chat Completions with a top-level prompt_cache_key and stable system prefix.';
  }
  if (strategy === 'chat-repeat') {
    return 'Repeated Chat Completions with only an identical long prefix; tests automatic provider prefix cache.';
  }
  if (strategy.includes('cache-control')) {
    return 'Anthropic-style cache_control blocks sent through an OpenAI-compatible route.';
  }
  return summary?.strategyDescription || 'Cache strategy not described.';
}

function resultByName(currentReport, name) {
  return currentReport.results.find((result) => result.name === name);
}

function resultStatus(currentReport, name) {
  const result = resultByName(currentReport, name);
  if (!result) return 'not-tested';
  return result.ok ? 'accepted' : 'rejected';
}

function checkedValue(checked) {
  return checked ? 'Checked' : 'Unchecked';
}

function providerHost() {
  try {
    return new URL(baseURL).hostname.toLowerCase();
  } catch {
    return baseURL.toLowerCase();
  }
}

function isApiklProvider() {
  return providerHost().endsWith('apikl.ai');
}

function isPptokenProvider() {
  return providerHost().endsWith('pptoken.org');
}

function cacheSettingsForStrategy(strategy, endpoint) {
  if (endpoint === '/chat/completions') {
    if (strategy === 'chat-session-header-prompt-cache-key') {
      return { chatPromptCacheKey: true, chatSessionId: true };
    }
    if (strategy === 'chat-session-header') {
      return { chatPromptCacheKey: false, chatSessionId: true };
    }
    if (strategy === 'chat-prompt-cache-key') {
      return { chatPromptCacheKey: true, chatSessionId: false };
    }
    return { chatPromptCacheKey: false, chatSessionId: false };
  }

  if (strategy === 'prompt-key-session-header') {
    return {
      responsesPromptCacheKey: 'Auto-generate',
      responsesSessionId: true,
      responsesStore: 'true',
    };
  }
  if (strategy === 'prompt-key-store-true') {
    return {
      responsesPromptCacheKey: 'Auto-generate',
      responsesSessionId: false,
      responsesStore: 'true',
    };
  }
  if (strategy === 'prompt-key-store-default') {
    return {
      responsesPromptCacheKey: 'Auto-generate',
      responsesSessionId: false,
      responsesStore: 'Default',
    };
  }
  if (strategy === 'prompt-key-store-false') {
    return {
      responsesPromptCacheKey: 'Auto-generate',
      responsesSessionId: false,
      responsesStore: 'false',
    };
  }
  if (strategy === 'session-header-only') {
    return {
      responsesPromptCacheKey: 'Do not send',
      responsesSessionId: true,
      responsesStore: 'true',
    };
  }
  if (strategy === 'implicit-derived-key') {
    return {
      responsesPromptCacheKey: 'Do not send',
      responsesSessionId: false,
      responsesStore: 'true',
    };
  }

  return {
    responsesPromptCacheKey: 'Do not send',
    responsesSessionId: false,
    responsesStore: 'Default',
  };
}

function responseParamSettings(currentReport) {
  const maxTokens = resultStatus(currentReport, 'responses.max_tokens');
  const maxOutputTokens = resultStatus(currentReport, 'responses.max_output_tokens');
  const truncationAuto = resultStatus(currentReport, 'responses.truncation.auto');
  const truncationDisabled = resultStatus(currentReport, 'responses.truncation.disabled');
  const verbosityTop = resultStatus(currentReport, 'responses.verbosity.topLevel');
  const verbosityText = resultStatus(currentReport, 'responses.verbosity.textObject');
  const verbosityBoth = resultStatus(currentReport, 'responses.verbosity.both');

  const truncation =
    truncationAuto === 'accepted'
      ? 'auto'
      : truncationDisabled === 'accepted'
        ? 'disabled'
        : 'Do not send';
  const verbosity =
    verbosityText === 'accepted'
      ? 'text.verbosity'
      : verbosityTop === 'accepted'
        ? 'top-level verbosity'
        : verbosityBoth === 'accepted'
          ? 'text.verbosity + top-level verbosity'
          : 'Do not send';

  return {
    maxOutputTokens: {
      reason:
        maxOutputTokens === 'accepted'
          ? 'Probe accepted responses.max_output_tokens.'
          : maxOutputTokens === 'rejected'
            ? 'Probe rejected responses.max_output_tokens.'
            : 'Not tested in this run; omit unless a params probe accepts it.',
      value: checkedValue(maxOutputTokens === 'accepted'),
    },
    maxTokens: {
      reason:
        maxTokens === 'accepted'
          ? 'Probe accepted responses.max_tokens.'
          : maxTokens === 'rejected'
            ? 'Probe rejected responses.max_tokens.'
            : 'Not tested in this run; omit unless a params probe accepts it.',
      value: checkedValue(maxTokens === 'accepted'),
    },
    truncation: {
      reason:
        truncationAuto === 'accepted'
          ? 'Probe accepted truncation:auto.'
          : truncationDisabled === 'accepted'
            ? 'Probe accepted truncation:disabled.'
            : truncationAuto === 'rejected' || truncationDisabled === 'rejected'
              ? 'Probe rejected tested truncation modes.'
              : 'Not tested in this run; omit unless a params probe accepts it.',
      value: truncation,
    },
    verbosity: {
      reason:
        verbosityText === 'accepted'
          ? 'Probe accepted text.verbosity.'
          : verbosityTop === 'accepted'
            ? 'Probe accepted top-level verbosity.'
            : verbosityBoth === 'accepted'
              ? 'Probe accepted both verbosity shapes together.'
              : verbosityText === 'rejected' || verbosityTop === 'rejected' || verbosityBoth === 'rejected'
                ? 'Probe rejected tested verbosity shapes.'
                : 'Not tested in this run; omit unless a params probe accepts it.',
      value: verbosity,
    },
  };
}

function cacheReportForEndpoint(cacheBehavior, endpoint) {
  if (endpoint === '/responses') {
    if (cacheBehavior.responses?.tested) return cacheBehavior.responses;
    if (cacheBehavior.singleEndpoint?.endpoint === '/responses') return cacheBehavior.singleEndpoint;
  }
  if (endpoint === '/chat/completions') {
    if (cacheBehavior.chatCompletions?.tested) return cacheBehavior.chatCompletions;
    if (cacheBehavior.singleEndpoint?.endpoint === '/chat/completions') return cacheBehavior.singleEndpoint;
  }
  return null;
}

function buildRecommendedSettings(currentReport, apiBehavior, cacheBehavior) {
  const responseCache = cacheReportForEndpoint(cacheBehavior, '/responses');
  const chatCache = cacheReportForEndpoint(cacheBehavior, '/chat/completions');
  const responseCacheSettings = cacheSettingsForStrategy(responseCache?.strategy, '/responses');
  const chatCacheSettings = cacheSettingsForStrategy(chatCache?.strategy, '/chat/completions');
  const responsesParams = responseParamSettings(currentReport);
  const route =
    responseCache?.likelyHit || apiBehavior.responses.works ? 'Responses API' : 'Chat Completions';
  const preset = isApiklProvider() ? 'apikl.ai' : isPptokenProvider() ? 'pptoken.org' : 'Custom';

  const builtInPreset = preset !== 'Custom';
  const settings = {
    route: {
      label: 'OpenAI-compatible API route',
      value: route,
    },
    preset: {
      label: 'OpenAI-compatible cache preset',
      value: preset,
    },
    cache: {
      chatPromptCacheKey: {
        label: 'Chat prompt_cache_key',
        value: checkedValue(Boolean(chatCacheSettings.chatPromptCacheKey)),
      },
      chatSessionId: {
        label: 'Chat Session_id',
        value: checkedValue(Boolean(chatCacheSettings.chatSessionId)),
      },
      responsesPromptCacheKey: {
        label: 'Responses prompt_cache_key',
        value: responseCacheSettings.responsesPromptCacheKey,
      },
      responsesSessionId: {
        label: 'Responses Session_id',
        value: checkedValue(Boolean(responseCacheSettings.responsesSessionId)),
      },
      responsesStore: {
        label: 'Responses store',
        value: responseCacheSettings.responsesStore,
      },
    },
    notes: [
      builtInPreset
        ? 'Built-in preset hides these detailed fields in the UI; the values below are the hidden matrix.'
        : 'Custom preset expands every cache and Responses parameter compatibility field.',
      'Dashboard/provider-log confirmation remains authoritative for cache billing.',
    ],
    responsesParams,
  };

  if (preset === 'apikl.ai') {
    settings.cache = {
      chatPromptCacheKey: { label: 'Chat prompt_cache_key', value: 'Checked' },
      chatSessionId: { label: 'Chat Session_id', value: 'Unchecked' },
      responsesPromptCacheKey: { label: 'Responses prompt_cache_key', value: 'Auto-generate' },
      responsesSessionId: { label: 'Responses Session_id', value: 'Unchecked' },
      responsesStore: { label: 'Responses store', value: 'Default' },
    };
    settings.responsesParams = {
      maxOutputTokens: {
        reason: 'apikl.ai preset omits this field because the params probe rejects it.',
        value: 'Unchecked',
      },
      maxTokens: {
        reason: 'apikl.ai preset omits this field because the params probe rejects it.',
        value: 'Unchecked',
      },
      truncation: {
        reason: 'apikl.ai preset omits this field because the params probe rejects it.',
        value: 'Do not send',
      },
      verbosity: {
        reason: 'apikl.ai preset sends the accepted Responses verbosity shape.',
        value: 'text.verbosity',
      },
    };
  } else if (preset === 'pptoken.org') {
    settings.cache = {
      chatPromptCacheKey: { label: 'Chat prompt_cache_key', value: 'Unchecked' },
      chatSessionId: { label: 'Chat Session_id', value: 'Unchecked' },
      responsesPromptCacheKey: { label: 'Responses prompt_cache_key', value: 'Auto-generate' },
      responsesSessionId: { label: 'Responses Session_id', value: 'Unchecked' },
      responsesStore: { label: 'Responses store', value: 'true' },
    };
  }

  settings.checklist = [
    settings.route,
    settings.preset,
    ...Object.values(settings.cache),
    { label: 'Responses max_tokens', ...settings.responsesParams.maxTokens },
    { label: 'Responses max_output_tokens', ...settings.responsesParams.maxOutputTokens },
    { label: 'Responses truncation', ...settings.responsesParams.truncation },
    { label: 'Responses verbosity', ...settings.responsesParams.verbosity },
  ];

  return settings;
}

function buildRecommendations(currentReport, apiBehavior, cacheBehavior) {
  const recommendations = [];
  if (!baseURL.endsWith('/v1')) {
    recommendations.push('Configure the base URL with /v1.');
  }
  if (apiBehavior.responses.works) {
    recommendations.push('Responses mode is available; use it only with fields this provider accepts.');
  }
  if (
    apiBehavior.responses.rejectedCalls.some((item) =>
      ['responses.max_tokens', 'responses.max_output_tokens'].includes(item.name),
    )
  ) {
    recommendations.push(
      'Use Custom Responses parameter compatibility to omit rejected max_tokens/max_output_tokens fields.',
    );
  }
  if (
    apiBehavior.responses.rejectedCalls.some((item) => item.name === 'responses.verbosity.topLevel') &&
    currentReport.results.some((result) => result.name === 'responses.verbosity.textObject' && result.ok)
  ) {
    recommendations.push('Use Custom Responses verbosity mode text.verbosity for this provider.');
  }
  const responseCache = cacheBehavior.responses || cacheBehavior.singleEndpoint;
  const chatCache = cacheBehavior.chatCompletions;
  if (responseCache?.likelyHit) {
    if (responseCache.intermittentHit) {
      recommendations.push(
        `Responses cache was observed intermittently with ${responseCache.mechanism}; rerun the same strategy with a fresh key and more rounds before calling it stable.`,
      );
    } else {
      recommendations.push(
        responseCache.confirmedByUser
          ? `Responses cache was user-confirmed with ${responseCache.mechanism}`
          : `Enable Responses cache with ${responseCache.mechanism}`,
      );
    }
  }
  if (chatCache?.tested && !chatCache.likelyHit) {
    recommendations.push('Treat Chat Completions cache as unconfirmed unless dashboard logs show hits.');
  } else if (chatCache?.likelyHit) {
    recommendations.push(
      chatCache.confirmedByUser
        ? `Chat Completions cache was user-confirmed with ${chatCache.mechanism}`
        : `Chat Completions cache was observed with ${chatCache.mechanism}`,
    );
  }
  return recommendations;
}

function buildProviderSummary(currentReport, apiBehavior, cacheBehavior) {
  const apiParts = [];
  apiParts.push(apiBehavior.chatCompletions.works ? 'Chat Completions works' : 'Chat Completions not confirmed');
  apiParts.push(apiBehavior.responses.works ? 'Responses API works' : 'Responses API not confirmed');

  const cacheParts = [];
  if (cacheBehavior.responses) {
    cacheParts.push(cacheStateLabel('Responses', cacheBehavior.responses));
  }
  if (cacheBehavior.chatCompletions) {
    cacheParts.push(cacheStateLabel('Chat Completions', cacheBehavior.chatCompletions));
  }
  if (cacheBehavior.singleEndpoint) {
    cacheParts.push(
      cacheBehavior.singleEndpoint.likelyHit
        ? `${cacheBehavior.singleEndpoint.endpoint || 'Endpoint'} cache hit observed`
        : `${cacheBehavior.singleEndpoint.endpoint || 'Endpoint'} cache hit not observed`,
    );
  }

  return [apiParts.join('; '), cacheParts.filter(Boolean).join('; ')].filter(Boolean).join('. ');
}

function cacheStateLabel(label, cacheReport) {
  if (cacheReport.confirmedByUser && cacheReport.intermittentHit) {
    return `${label} cache confirmed but intermittent`;
  }
  if (cacheReport.confirmedByUser) return `${label} cache confirmed`;
  if (cacheReport.likelyHit && cacheReport.intermittentHit) {
    return `${label} cache hit observed intermittently`;
  }
  return cacheReport.likelyHit ? `${label} cache hit observed` : `${label} cache hit not observed`;
}

function cacheRoundSummary(result) {
  return {
    cacheSignals: result.cacheSignals,
    cachedTokens: result.cachedTokens,
    diagnosticHeaders: result.diagnosticHeaders,
    durationMs: result.durationMs,
    errorDetail: result.errorDetail,
    ok: result.ok,
    requestId: result.requestId,
    responseId: result.responseId,
    status: result.status,
    usage: result.usage,
  };
}

function summarizeCacheResults(strategy, results, extra = {}) {
  const rounds = results.map((result) => cacheRoundSummary(result));
  const hitStats = cacheHitStats(rounds);
  const likelyHit = hitStats.laterHitCount > 0;
  const creationSeen = rounds.some((round) => Number(round.cacheSignals?.cacheCreationTokens || 0) > 0);
  const missSeen = rounds.some((round) => Number(round.cacheSignals?.cacheMissTokens || 0) > 0);

  return {
    ...extra,
    creationSeen,
    hitRate: hitStats.hitRate,
    intermittentHit: hitStats.intermittentHit,
    laterHitCount: hitStats.laterHitCount,
    laterRoundCount: hitStats.laterRoundCount,
    likelyHit,
    missSeen,
    stableAfterWarmup: hitStats.stableAfterWarmup,
    stability: hitStats.stability,
    note: likelyHit
      ? hitStats.stableAfterWarmup
        ? 'Every later round reported cached tokens after the warm-up request.'
        : `Only some later rounds reported cached tokens (${hitStats.hitRate}); treat this as an intermittent hit until a fresh stability round confirms the hit rate.`
      : creationSeen
        ? 'Cache creation/write tokens were reported, but no later round reported cache-read tokens yet. Ask the user to verify dashboard/logs, then repeat after the provider cache TTL/warmup window.'
        : 'No later round reported cached tokens. Ask the user to verify provider dashboard/logs before trying another strategy.',
    rounds,
    strategy,
  };
}

function cacheReadTokens(round) {
  const value = Number(round?.cacheSignals?.cacheReadTokens ?? round?.cachedTokens ?? 0);
  return Number.isFinite(value) ? value : 0;
}

function cacheHitStats(rounds) {
  const classifiedRounds = rounds.map((round, index) => ({
    cachedTokens: cacheReadTokens(round),
    index: index + 1,
    requestId: round.requestId,
  }));
  const hitRounds = classifiedRounds.filter((round) => round.cachedTokens > 0);
  const laterRounds = classifiedRounds.slice(1);
  const laterHitCount = laterRounds.filter((round) => round.cachedTokens > 0).length;
  const laterRoundCount = laterRounds.length;
  const stableAfterWarmup = laterRoundCount > 0 && laterHitCount === laterRoundCount;
  const intermittentHit = laterHitCount > 0 && !stableAfterWarmup;
  const stability =
    laterRoundCount === 0
      ? 'not-measured'
      : stableAfterWarmup
        ? 'stable-after-warmup'
        : intermittentHit
          ? 'intermittent'
          : 'not-observed';

  return {
    hitRate: `${laterHitCount}/${laterRoundCount}`,
    hitRounds,
    intermittentHit,
    laterHitCount,
    laterRoundCount,
    maxCacheReadTokens: hitRounds.reduce((max, round) => Math.max(max, round.cachedTokens), 0),
    stability,
    stableAfterWarmup,
  };
}

function unique(values) {
  return Array.from(new Set(values.filter(Boolean)));
}

function summarizeCacheComparison(responseSummary, chatSummary) {
  const responsesLikelyHit = Boolean(responseSummary?.likelyHit);
  const chatCompletionsLikelyHit = Boolean(chatSummary?.likelyHit);
  const responsesConfirmed = Boolean(responseSummary?.confirmedByUser);
  const chatCompletionsConfirmed = Boolean(chatSummary?.confirmedByUser);
  const responseHitText = responseSummary?.intermittentHit
    ? '/responses reported intermittent cache-read tokens'
    : '/responses reported cache-read tokens';
  const chatHitText = chatSummary?.intermittentHit
    ? '/chat/completions reported intermittent cache-read tokens'
    : '/chat/completions reported cache-read tokens';
  let conclusion = 'Neither endpoint reported later-round cache-read tokens.';
  if (responsesConfirmed && chatCompletionsConfirmed) {
    conclusion = 'Both /responses and /chat/completions have user-confirmed cache strategies.';
  } else if (responsesConfirmed && chatCompletionsLikelyHit) {
    conclusion = `/responses is user-confirmed; ${chatHitText} in this run.`;
  } else if (responsesConfirmed) {
    conclusion = '/responses is user-confirmed; /chat/completions did not report cache-read tokens in this run.';
  } else if (chatCompletionsConfirmed && responsesLikelyHit) {
    conclusion = `/chat/completions is user-confirmed; ${responseHitText} in this run.`;
  } else if (chatCompletionsConfirmed) {
    conclusion = '/chat/completions is user-confirmed; /responses did not report cache-read tokens in this run.';
  } else if (responsesLikelyHit && chatCompletionsLikelyHit) {
    conclusion = `${responseHitText}; ${chatHitText}.`;
  } else if (responsesLikelyHit) {
    conclusion = `${responseHitText}; /chat/completions did not in this run.`;
  } else if (chatCompletionsLikelyHit) {
    conclusion = `${chatHitText}; /responses did not in this run.`;
  }

  return {
    chatCompletionsLikelyHit,
    conclusion,
    responsesLikelyHit,
  };
}

function bestCacheSummary(summaries) {
  const usable = summaries.filter(Boolean);
  if (usable.length === 0) return null;

  const hits = usable.filter((summary) => summary.likelyHit);
  if (hits.length > 0) {
    return hits.sort((a, b) => maxCacheReadTokens(b) - maxCacheReadTokens(a))[0];
  }

  return usable[0];
}

function maxCacheReadTokens(summary) {
  return (summary?.rounds || []).reduce((max, round) => {
    const value = cacheReadTokens(round);
    return Math.max(max, value);
  }, 0);
}

function confirmedCacheSummary(endpoint, strategy) {
  return {
    confirmedByUser: true,
    endpoint,
    likelyHit: true,
    note:
      'User confirmed this endpoint cache mechanism in provider dashboard/logs; it was locked while probing the other endpoint.',
    rounds: [],
    strategy,
  };
}

function summarizeCacheRound({
  chatStrategy,
  confirmedChatStrategy,
  confirmedResponseStrategy,
  endpointScope,
  responseStrategy,
  testChat,
  testResponses,
}) {
  return {
    bounded: true,
    chatCompletions: {
      confirmedStrategy: confirmedChatStrategy || null,
      locked: Boolean(confirmedChatStrategy),
      testedStrategy: testChat ? chatStrategy : null,
    },
    endpointScope,
    nextAction:
      'Stop after this round. Ask the user to verify the listed request IDs in provider dashboard/logs before running another cache strategy.',
    responses: {
      confirmedStrategy: confirmedResponseStrategy || null,
      locked: Boolean(confirmedResponseStrategy),
      testedStrategy: testResponses ? responseStrategy : null,
    },
    userConfirmationRequired: Boolean(testChat || testResponses),
  };
}

function summarizeCacheMatrix({
  chatStrategies,
  chatSummaries,
  confirmedChatStrategy,
  confirmedResponseStrategy,
  endpointScope,
  includeLateStrategies,
  responseStrategies,
  responseSummaries,
  testChat,
  testResponses,
}) {
  const responseHits = responseSummaries.filter((summary) => summary?.likelyHit);
  const chatHits = chatSummaries.filter((summary) => summary?.likelyHit);

  return {
    chatCompletions: {
      confirmedStrategy: confirmedChatStrategy || null,
      exhausted: Boolean(testChat && chatSummaries.length === chatStrategies.length && chatHits.length === 0),
      hitStrategies: cacheMatrixEntries(chatHits),
      locked: Boolean(confirmedChatStrategy),
      testedStrategies: chatSummaries.map((summary) => summary.strategy),
    },
    endpointScope,
    includeLateStrategies,
    nextAction:
      'Pause for provider dashboard/log confirmation. Keep confirmed endpoint strategies locked, then continue the matrix only for endpoints that remain unconfirmed.',
    responses: {
      confirmedStrategy: confirmedResponseStrategy || null,
      exhausted: Boolean(
        testResponses && responseSummaries.length === responseStrategies.length && responseHits.length === 0,
      ),
      hitStrategies: cacheMatrixEntries(responseHits),
      locked: Boolean(confirmedResponseStrategy),
      testedStrategies: responseSummaries.map((summary) => summary.strategy),
    },
    strategyCatalog: {
      chatCompletions: chatStrategies,
      responses: responseStrategies,
    },
  };
}

function cacheMatrixEntries(summaries) {
  return summaries.map((summary) => ({
    hitRate: summary.hitRate,
    intermittentHit: Boolean(summary.intermittentHit),
    maxCacheReadTokens: maxCacheReadTokens(summary),
    requestIds: (summary.rounds || []).map((round) => round.requestId).filter(Boolean),
    stability: summary.stability || null,
    stableAfterWarmup: Boolean(summary.stableAfterWarmup),
    strategy: summary.strategy,
  }));
}

function scopedCacheKey(scope) {
  return `chathub_probe_${scope}_${sha256(`${baseURL}|${model}|${scope}|${probeNonce}`).slice(0, 24)}`;
}

function cacheBothKey(scope) {
  return args.cacheKey ? `${args.cacheKey}_${scope}` : scopedCacheKey(scope);
}

function responseCacheStrategy(strategy, promptCacheKey) {
  const configs = {
    'cache-control-content-blocks': {
      cacheControlBlocks: true,
      description:
        'Responses request with Anthropic-style cache_control text blocks. Useful for detecting gateways that accept cache_control through an OpenAI-compatible facade.',
      headers: {},
      includePromptCacheKey: true,
      store: true,
    },
    'codex-client-metadata': {
      clientMetadata: { 'x-codex-window-id': promptCacheKey },
      description:
        'Responses request with prompt_cache_key plus client_metadata.x-codex-window-id for Codex/CLIProxy-style replay session keys.',
      headers: { Session_id: promptCacheKey },
      includePromptCacheKey: true,
      store: true,
    },
    'implicit-derived-key': {
      description:
        'Responses request without explicit prompt_cache_key. Tests backends that derive cache keys from model, reasoning, tools, system prompt, and first user turn.',
      headers: {},
      includePromptCacheKey: false,
      store: true,
    },
    'prompt-key-session-header': {
      description:
        'Responses request with prompt_cache_key and Session_id header. Covers OpenAI-style prompt cache keys and CLIProxy-style session IDs.',
      headers: { Session_id: promptCacheKey },
      includePromptCacheKey: true,
      store: true,
    },
    'prompt-key-store-false': {
      description:
        'Responses request with prompt_cache_key and store:false. Tests gateways that treat prompt_cache_key independently from stored response state.',
      headers: {},
      includePromptCacheKey: true,
      store: false,
    },
    'prompt-key-store-default': {
      description:
        'Responses request with prompt_cache_key and no store field. Matches ChatHub OpenAI-compatible cache matrix store:default.',
      headers: {},
      includePromptCacheKey: true,
      store: undefined,
    },
    'prompt-key-store-true': {
      description:
        'Responses request with prompt_cache_key and store:true. Matches ChatHub response-state cache hints when enabled.',
      headers: {},
      includePromptCacheKey: true,
      store: true,
    },
    'session-header-only': {
      description:
        'Responses request with Session_id header only. Tests gateways that key cache state from headers and reject prompt_cache_key.',
      headers: { Session_id: promptCacheKey },
      includePromptCacheKey: false,
      store: true,
    },
  };
  const config = configs[strategy];
  if (!config) throw new Error(`Unknown cache-key --strategy ${strategy}`);
  return config;
}

function chatCacheStrategy(strategy, promptCacheKey) {
  const configs = {
    'chat-cache-control-content': {
      cacheControlBlocks: true,
      description:
        'Chat Completions repeat with Anthropic-style cache_control text blocks. This may be rejected by strict OpenAI-compatible gateways.',
      headers: {},
      includePromptCacheKey: false,
    },
    'chat-prompt-cache-key': {
      description:
        'Chat Completions repeat with top-level prompt_cache_key. Tests gateways that accept OpenAI-style cache hints on chat routes.',
      headers: {},
      includePromptCacheKey: true,
    },
    'chat-session-header-prompt-cache-key': {
      description:
        'Chat Completions repeat with both Session_id and top-level prompt_cache_key. Tests gateways that require both cache routing signals together.',
      headers: { Session_id: promptCacheKey },
      includePromptCacheKey: true,
    },
    'chat-repeat': {
      description:
        'Plain repeated Chat Completions request with a long stable system prefix. Tests automatic prefix-cache behavior.',
      headers: {},
      includePromptCacheKey: false,
    },
    'chat-session-header': {
      description:
        'Repeated Chat Completions request with a stable Session_id header. Covers CLIProxy-style session cache routing.',
      headers: { Session_id: promptCacheKey },
      includePromptCacheKey: false,
    },
  };
  const config = configs[strategy];
  if (!config) throw new Error(`Unknown cache-chat-repeat --strategy ${strategy}`);
  return config;
}

function cacheInput(round, options = {}) {
  const input = [
    responseInputMessage('developer', longStablePrefix(), options),
    responseInputMessage(
      'user',
      'Stable first user turn for cache-key derivation. Answer with ok when asked.',
      options,
    ),
  ];

  if (round > 0) input.push({ content: 'ok', role: 'assistant' });

  input.push(responseInputMessage('user', `Cache probe round ${round + 1}. Say exactly: ok`, options));

  return input;
}

function responseInputMessage(role, text, options = {}) {
  if (!options.cacheControlBlocks) return { content: text, role };
  return {
    content: [
      {
        cache_control: { type: 'ephemeral' },
        text,
        type: 'input_text',
      },
    ],
    role,
  };
}

function chatCacheMessages(round, options = {}) {
  return [
    chatMessage('system', longStablePrefix(), options),
    chatMessage('user', `Round ${round + 1}. Say exactly: ok`, options),
  ];
}

function chatMessage(role, text, options = {}) {
  if (!options.cacheControlBlocks) return { content: text, role };
  return {
    content: [
      {
        cache_control: { type: 'ephemeral' },
        text,
        type: 'text',
      },
    ],
    role,
  };
}

function longStablePrefix() {
  const repeats = numberArg(args.prefixRepeats, 120);
  const line =
    'Stable cache probe instruction: preserve this prefix exactly so provider-side prompt caching can match it.';
  return Array.from({ length: repeats }, (_, index) => `${index + 1}. ${line}`).join('\n');
}

function parseArgs(argv) {
  const parsed = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) continue;
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) parsed[key] = true;
    else {
      parsed[key] = next;
      i += 1;
    }
  }
  return parsed;
}

function parseListArg(value, fallback) {
  if (!value || value === true) return fallback;
  return String(value)
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function stringArg(value) {
  if (!value || value === true) return '';
  return String(value).trim();
}

function numberArg(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

function trimTrailingSlash(value) {
  return value.replace(/\/+$/, '');
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function snippet(value, max = 600) {
  const clean = String(value || '').replaceAll(apiKey, '[REDACTED_API_KEY]');
  return clean.length > max ? `${clean.slice(0, max)}...` : clean;
}
