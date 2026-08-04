import { AsyncLocalStorage } from 'node:async_hooks';
import { createHmac, randomUUID } from 'node:crypto';

import { CHATHUB_KNOWLEDGE_DIAGNOSTIC_ID_PATTERN } from '@/const/tools';

import { type KnowledgeDebugLevel, parseKnowledgeDebugLevel } from './bootstrap';

const NAMESPACE = 'chathub-knowledge-debug';
const MAX_ARRAY = 16;
const MAX_DEPTH = 5;
const MAX_PROPERTIES = 48;
const MAX_RECORD_BYTES = 16 * 1024;

const SENSITIVE_KEY =
  /query|prompt|content|text|body|message|stack|url|uri|filename|name|secret|token|password|api[_-]?key|authorization|cookie|credential|header/i;
const IDENTIFIER_KEY =
  /(?:^|_)(?:user|account|session|topic|message|file|chunk|task|knowledge)ids?$/i;
const SAFE_STRING_KEY =
  /^(?:debugLevel|diagnosticId|errorClass|errorCode|event|failurePhase|inputType|operation|outcome|phase|providerSource|reason|runtime|schemaVersion|spanId|status|strategy|timestamp|transport|type)$/;

export type KnowledgeDebugEvent =
  | 'async_route_settled'
  | 'async_route_started'
  | 'chunking_settled'
  | 'chunking_started'
  | 'client_preparation_failed'
  | 'config_warning'
  | 'document_registration_settled'
  | 'embedding_batch_settled'
  | 'embedding_provider_settled'
  | 'embedding_provider_started'
  | 'embedding_task_settled'
  | 'knowledge_association_settled'
  | 'prompt_injection_reported'
  | 'query_embedding_settled'
  | 'reindex_settled'
  | 'reindex_started'
  | 'retrieval_settled'
  | 'retrieval_started'
  | 'scope_expansion_settled'
  | 'storage_read_settled'
  | 'task_dispatch_settled'
  | 'task_dispatch_started'
  | 'vector_search_settled';

export interface KnowledgeDebugContext {
  diagnosticId?: string;
  operation?: string;
  runtime?: string;
  transport?: string;
}

interface KnowledgeDebugStore extends KnowledgeDebugContext {
  sequence: { value: number };
  spanId: string;
  startedAt: number;
}

const storage = new AsyncLocalStorage<KnowledgeDebugStore>();
let missingFingerprintKeyWarningLogged = false;

const fingerprintKey = () => process.env.KEY_VAULTS_SECRET || process.env.NEXT_AUTH_SECRET;

export const fingerprintKnowledgeDebugValue = (
  scope: string,
  value: unknown,
): string | undefined => {
  const key = fingerprintKey();
  if (!key) return;

  let serialized: string;
  try {
    serialized = JSON.stringify(value);
  } catch {
    serialized = Object.prototype.toString.call(value);
  }

  return createHmac('sha256', key)
    .update(`chathub:knowledge-debug:${scope}\0`)
    .update(serialized.slice(0, 64 * 1024))
    .digest('hex')
    .slice(0, 32);
};

export const createKnowledgeDiagnosticId = () =>
  `kb_${randomUUID().replaceAll('-', '').slice(0, 20)}`;

export const normalizeKnowledgeDiagnosticId = (value: string | null | undefined) =>
  value && CHATHUB_KNOWLEDGE_DIAGNOSTIC_ID_PATTERN.test(value) ? value : undefined;

export const isKnowledgeDebugEnabled = (
  minimumLevel: Exclude<KnowledgeDebugLevel, 'off'> = 'safe',
) => {
  const level = parseKnowledgeDebugLevel(process.env.CHATHUB_KNOWLEDGE_DEBUG);
  return level === 'verbose' || (level === 'safe' && minimumLevel === 'safe');
};

export const getKnowledgeDebugContext = (): Readonly<KnowledgeDebugContext> | undefined =>
  storage.getStore();

export const runWithKnowledgeDebugContext = <T>(
  context: KnowledgeDebugContext,
  callback: () => T,
): T => {
  const parent = storage.getStore();
  const store: KnowledgeDebugStore = {
    ...parent,
    ...context,
    diagnosticId:
      normalizeKnowledgeDiagnosticId(context.diagnosticId) ||
      parent?.diagnosticId ||
      createKnowledgeDiagnosticId(),
    sequence: parent?.sequence || { value: 0 },
    spanId: parent?.spanId || `ks_${randomUUID().replaceAll('-', '').slice(0, 16)}`,
    startedAt: parent?.startedAt || Date.now(),
  };

  return storage.run(store, callback);
};

export const runWithKnowledgeDebugOperation = <T>(
  context: Omit<KnowledgeDebugContext, 'diagnosticId'> & { diagnosticId?: string },
  callback: () => T,
): T => (isKnowledgeDebugEnabled() ? runWithKnowledgeDebugContext(context, callback) : callback());

export const describeKnowledgeDebugError = (error: unknown) => {
  const candidate = error as { code?: unknown; name?: unknown } | undefined;
  const code = candidate?.code;
  return {
    errorClass:
      typeof candidate?.name === 'string' && /^[A-Za-z][\dA-Za-z]{0,63}$/.test(candidate.name)
        ? candidate.name
        : 'OtherError',
    errorCode:
      (typeof code === 'string' && /^[A-Z][\dA-Z_]{1,63}$/.test(code)) || typeof code === 'number'
        ? code
        : undefined,
  };
};

const describeValue = (scope: string, value: unknown, includeFingerprint: boolean) => ({
  hash: includeFingerprint ? fingerprintKnowledgeDebugValue(scope, value) : undefined,
  length: typeof value === 'string' ? value.length : undefined,
  type: Array.isArray(value) ? 'array' : typeof value,
});

const sanitize = (
  value: unknown,
  key = '',
  depth = 0,
  level: 'safe' | 'verbose' = 'safe',
): unknown => {
  if (value === null || value === undefined) return value;
  if (depth >= MAX_DEPTH) return '[truncated:max-depth]';
  if (typeof value === 'string') {
    if (SENSITIVE_KEY.test(key) || IDENTIFIER_KEY.test(key)) {
      return describeValue(key || 'value', value, level === 'verbose');
    }
    return SAFE_STRING_KEY.test(key) && /^[\w.:-]{1,96}$/.test(value)
      ? value
      : describeValue(key || 'string', value, level === 'verbose');
  }
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value === 'boolean') return value;
  if (SENSITIVE_KEY.test(key) || IDENTIFIER_KEY.test(key))
    return describeValue(key || 'value', value, level === 'verbose');
  if (typeof value !== 'object') return { type: typeof value };
  if (Array.isArray(value)) {
    return value.slice(0, MAX_ARRAY).map((item) => sanitize(item, key, depth + 1, level));
  }

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .slice(0, MAX_PROPERTIES)
      .flatMap(([childKey, childValue]) => {
        const sanitized = sanitize(childValue, childKey, depth + 1, level);
        return sanitized === undefined ? [] : [[childKey, sanitized]];
      }),
  );
};

const write = (event: KnowledgeDebugEvent, level: 'safe' | 'verbose', fields: unknown) => {
  try {
    const context = storage.getStore();
    const record = sanitize(
      {
        debugLevel: level,
        diagnosticId: context?.diagnosticId,
        elapsedMs: context ? Date.now() - context.startedAt : undefined,
        eventSequence: context ? ++context.sequence.value : undefined,
        operation: context?.operation,
        runtime: context?.runtime,
        schemaVersion: 1,
        spanId: context?.spanId,
        timestamp: new Date().toISOString(),
        transport: context?.transport,
        ...(fields as Record<string, unknown>),
      },
      '',
      0,
      level,
    ) as Record<string, unknown>;
    let json = JSON.stringify(record);
    const bytes = Buffer.byteLength(json, 'utf8');
    if (bytes > MAX_RECORD_BYTES) {
      json = JSON.stringify({
        debugLevel: level,
        diagnosticId: record.diagnosticId,
        eventSequence: record.eventSequence,
        originalRecordBytes: bytes,
        recordTruncated: true,
        schemaVersion: 1,
        spanId: record.spanId,
        timestamp: record.timestamp,
      });
    }
    // eslint-disable-next-line no-console
    console.log(`[${NAMESPACE}:${event}]`, json);
  } catch {
    // Diagnostics must never interrupt Knowledge Base work.
  }
};

export const logKnowledgeDebugSafe = (
  event: KnowledgeDebugEvent,
  fields: Record<string, unknown> = {},
) => {
  if (!isKnowledgeDebugEnabled()) return;
  write(event, 'safe', fields);
};

export const logKnowledgeDebugVerbose = (event: KnowledgeDebugEvent, payload: unknown) => {
  if (!isKnowledgeDebugEnabled('verbose')) return;

  if (!fingerprintKey()) {
    if (!missingFingerprintKeyWarningLogged) {
      missingFingerprintKeyWarningLogged = true;
      write('config_warning', 'safe', {
        outcome: 'warning',
        phase: 'configuration',
        reason: 'fingerprint_key_unavailable',
      });
    }
    return;
  }

  write(event, 'verbose', { payload });
};
