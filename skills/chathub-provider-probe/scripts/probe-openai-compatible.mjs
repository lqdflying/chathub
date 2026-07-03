#!/usr/bin/env node

import crypto from 'node:crypto';

const DEFAULT_MODEL = 'gpt-5.5';
const DEFAULT_TIMEOUT_MS = 30_000;

const args = parseArgs(process.argv.slice(2));
const phase = args.phase || 'baseline';
const apiKey =
  process.env.CHATHUB_OPENAICOMPATIBLE_API_KEY || process.env.OPENAICOMPATIBLE_API_KEY || '';
const rawBaseURL =
  process.env.CHATHUB_OPENAICOMPATIBLE_PROXY_URL || process.env.OPENAICOMPATIBLE_PROXY_URL || '';
const baseURL = trimTrailingSlash(rawBaseURL.trim());
const model = args.model || process.env.CHATHUB_OPENAICOMPATIBLE_MODEL || DEFAULT_MODEL;
const timeoutMs = numberArg(args.timeoutMs, DEFAULT_TIMEOUT_MS);

if (!apiKey || !baseURL) {
  console.error(
    JSON.stringify(
      {
        error:
          'Missing CHATHUB_OPENAICOMPATIBLE_API_KEY or CHATHUB_OPENAICOMPATIBLE_PROXY_URL.',
        requiredEnv: [
          'CHATHUB_OPENAICOMPATIBLE_API_KEY',
          'CHATHUB_OPENAICOMPATIBLE_PROXY_URL',
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
  else if (phase === 'cache-key') await runCacheKey(args.strategy || 'prompt-key-store-true');
  else if (phase === 'cache-previous-response') await runPreviousResponse();
  else if (phase === 'cache-chat-repeat') await runChatRepeat();
  else if (phase === 'all') {
    await runBaseline();
    await runParams();
  } else {
    throw new Error(`Unknown --phase ${phase}`);
  }

  finalizeDiagnosis(report);
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
  await record('responses.truncation.auto', () =>
    request('/responses', {
      body: { ...responseBase, truncation: 'auto' },
      method: 'POST',
    }),
  );
}

async function runCacheKey(strategy) {
  const store = strategy !== 'prompt-key-store-false';
  const promptCacheKey =
    args.cacheKey || `chathub_probe_${sha256(`${baseURL}|${model}`).slice(0, 24)}`;
  const runs = numberArg(args.runs, 2);
  const pauseMs = numberArg(args.pauseMs, 2_000);
  const results = [];

  for (let i = 0; i < runs; i += 1) {
    const body = {
      input: cacheInput(i),
      model,
      prompt_cache_key: promptCacheKey,
      reasoning: { effort: 'low' },
      store,
      stream: true,
    };
    const result = await record(`cache.${strategy}.round${i + 1}`, () =>
      request('/responses', { body, method: 'POST' }),
    );
    results.push(result);
    if (i + 1 < runs) await sleep(pauseMs);
  }

  report.cacheSummary = summarizeCacheResults(strategy, results, { promptCacheKey, store });
}

async function runPreviousResponse() {
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
    report.cacheSummary = {
      likelyHit: false,
      note: 'First response did not expose a response id; cannot test previous_response_id.',
      strategy: 'previous-response',
    };
    return;
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

  report.cacheSummary = summarizeCacheResults('previous-response', [first, second], {
    previousResponseId,
  });
}

async function runChatRepeat() {
  const runs = numberArg(args.runs, 2);
  const pauseMs = numberArg(args.pauseMs, 2_000);
  const results = [];

  for (let i = 0; i < runs; i += 1) {
    const result = await record(`cache.chatRepeat.round${i + 1}`, () =>
      request('/chat/completions', {
        body: {
          messages: [
            { content: longStablePrefix(), role: 'system' },
            { content: `Round ${i + 1}. Say exactly: ok`, role: 'user' },
          ],
          model,
          stream: false,
        },
        method: 'POST',
      }),
    );
    results.push(result);
    if (i + 1 < runs) await sleep(pauseMs);
  }

  report.cacheSummary = summarizeCacheResults('chat-repeat', results);
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

async function request(path, { body, method }) {
  const headers = {
    Authorization: `Bearer ${apiKey}`,
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
  const cachedTokens = extractCachedTokens(usage, parsed, finalResponse);

  return {
    cachedTokens,
    contentType,
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
  if (finalResponse?.usage) return finalResponse.usage;
  if (parsed.json?.usage) return parsed.json.usage;
  if (Array.isArray(parsed.json?.choices)) {
    for (const choice of parsed.json.choices) {
      if (choice?.usage) return choice.usage;
    }
  }
  return null;
}

function extractCachedTokens(usage, parsed, finalResponse) {
  const candidates = [
    usage?.input_tokens_details?.cached_tokens,
    usage?.prompt_tokens_details?.cached_tokens,
    usage?.cached_tokens,
    usage?.prompt_cache_hit_tokens,
    parsed.json?.input_tokens_details?.cached_tokens,
    parsed.json?.prompt_tokens_details?.cached_tokens,
    finalResponse?.input_tokens_details?.cached_tokens,
    finalResponse?.prompt_tokens_details?.cached_tokens,
    parsed.json?.timings?.cache_n,
  ];

  for (const candidate of candidates) {
    const n = Number(candidate);
    if (Number.isFinite(n) && n >= 0) return Math.trunc(n);
  }
  return null;
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

  currentReport.diagnosis.keyWorks = Boolean(
    models?.ok || chat?.ok || responses?.ok || currentReport.results.some((r) => r.status === 200),
  );
  currentReport.diagnosis.chatCompletionsWorks = Boolean(chat?.ok);
  currentReport.diagnosis.responsesWorks = Boolean(responses?.ok);

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
      'Responses rejects top-level verbosity but accepts text.verbosity; ChatHub OpenAI-compatible mapping should use text: { verbosity } for this provider.',
    );
  }

  const truncation = byName['responses.truncation.auto'];
  if (truncation && !truncation.ok) {
    currentReport.diagnosis.discrepancies.push(
      `Responses rejects truncation: ${truncation.errorDetail || truncation.status}.`,
    );
  }
}

function summarizeCacheResults(strategy, results, extra = {}) {
  const rounds = results.map((result) => ({
    cachedTokens: result.cachedTokens,
    errorDetail: result.errorDetail,
    ok: result.ok,
    requestId: result.requestId,
    responseId: result.responseId,
    status: result.status,
    usage: result.usage,
  }));
  const laterRounds = rounds.slice(1);
  const likelyHit = laterRounds.some((round) => Number(round.cachedTokens || 0) > 0);

  return {
    ...extra,
    likelyHit,
    note: likelyHit
      ? 'At least one later round reported cached tokens.'
      : 'No later round reported cached tokens. Ask the user to verify provider dashboard/logs before trying another strategy.',
    rounds,
    strategy,
  };
}

function cacheInput(round) {
  const input = [
    {
      content: longStablePrefix(),
      role: 'developer',
    },
    {
      content: 'Stable first user turn for cache-key derivation. Answer with ok when asked.',
      role: 'user',
    },
  ];

  if (round > 0) input.push({ content: 'ok', role: 'assistant' });

  input.push({
    content: `Cache probe round ${round + 1}. Say exactly: ok`,
    role: 'user',
  });

  return input;
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
