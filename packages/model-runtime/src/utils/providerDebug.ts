type ProviderDebugRoute = '/chat/completions' | '/responses' | '/v1/messages';

const SECRET_KEY_PATTERN =
  /^(?:api[_-]?key|authorization|auth[_-]?token|cookie|password|secret|token|access[_-]?token|client[_-]?secret|x-api-key)$/i;

const sanitizeForDebug = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(sanitizeForDebug);
  if (!value || typeof value !== 'object') return value;

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, item]) => [
      key,
      SECRET_KEY_PATTERN.test(key) ? '[redacted]' : sanitizeForDebug(item),
    ]),
  );
};

const stableStringify = (value: unknown) => {
  try {
    return (
      JSON.stringify(value, (_, item) => (typeof item === 'bigint' ? item.toString() : item)) ??
      String(value)
    );
  } catch {
    return String(value);
  }
};

export const stableHash = (value: unknown) => {
  const text = typeof value === 'string' ? value : stableStringify(value);
  let hash = 2_166_136_261;

  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16_777_619);
  }

  return (hash >>> 0).toString(16).padStart(8, '0');
};

const asRecord = (value: unknown): Record<string, any> =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, any>) : {};

const contentShape = (content: unknown) => {
  if (typeof content === 'string') return 'text';
  if (!Array.isArray(content)) return content === undefined || content === null ? 'empty' : typeof content;

  return content
    .map((part) => {
      const value = asRecord(part);
      return typeof value.type === 'string' ? value.type : typeof part;
    })
    .join(',');
};

const itemKind = (item: any) => {
  if (!item || typeof item !== 'object') return typeof item;

  const role = typeof item.role === 'string' ? item.role : '';
  const type = typeof item.type === 'string' ? item.type : '';
  if (role && type) return `${role}:${type}`;
  return role || type || 'object';
};

const sequenceSummary = (items: unknown) => {
  if (!Array.isArray(items)) return { count: 0, sequence: [] as string[] };

  return {
    count: items.length,
    sequence: items.map((item: any) => `${itemKind(item)}:${contentShape(item?.content)}`),
  };
};

const toolSummary = (tools: unknown) => {
  if (!Array.isArray(tools)) return { count: 0, fingerprint: stableHash([]) };

  return {
    count: tools.length,
    fingerprint: stableHash(tools),
  };
};

const paramShape = (payload: Record<string, any>) => ({
  hasMaxOutputTokens: payload.max_output_tokens !== undefined,
  hasMaxTokens: payload.max_tokens !== undefined,
  hasMetadata: payload.metadata !== undefined,
  hasReasoningEffort: payload.reasoning_effort !== undefined,
  hasStreamOptions: payload.stream_options !== undefined,
  hasTemperature: payload.temperature !== undefined,
  hasThinking: payload.thinking !== undefined,
  hasToolChoice: payload.tool_choice !== undefined,
  hasTopP: payload.top_p !== undefined,
  thinkingType: asRecord(payload.thinking).type ?? null,
});

export const buildEffectiveProviderURL = (baseURL: string | undefined, route: ProviderDebugRoute) => {
  if (!baseURL) return route;
  if (/^https?:\/\//i.test(route)) return route;

  try {
    const parsedBaseURL = new URL(baseURL);
    parsedBaseURL.pathname = `${parsedBaseURL.pathname.replace(/\/+$/, '')}/${route.replace(
      /^\/+/,
      '',
    )}`;
    return parsedBaseURL.toString();
  } catch {
    return `${baseURL.replace(/\/+$/, '')}/${route.replace(/^\/+/, '')}`;
  }
};

export const summarizeProviderDebugURL = (value: string | undefined) => {
  if (!value) return { present: false as const };

  try {
    const parsedURL = new URL(value, value.startsWith('/') ? 'https://relative.invalid' : undefined);
    const isRelative = value.startsWith('/');
    const pathSegments = parsedURL.pathname.split('/').filter(Boolean);

    return {
      originHash: isRelative ? undefined : stableHash(parsedURL.origin),
      pathDepth: pathSegments.length,
      pathHash: stableHash(parsedURL.pathname),
      present: true as const,
      queryKeys: [...new Set(parsedURL.searchParams.keys())].sort(),
      relative: isRelative,
    };
  } catch {
    return {
      hash: stableHash(value),
      present: true as const,
      valid: false as const,
    };
  }
};

export const buildProviderDebugRequest = ({
  baseURL,
  payload,
  provider,
  route,
}: {
  baseURL?: string;
  payload: Record<string, any>;
  provider: string;
  route: ProviderDebugRoute;
}) => {
  const messages = payload.messages ?? payload.input;

  return {
    baseURL: summarizeProviderDebugURL(baseURL),
    effectiveURL: summarizeProviderDebugURL(buildEffectiveProviderURL(baseURL, route)),
    model: payload.model,
    params: paramShape(payload),
    payloadFingerprint: stableHash(sanitizeForDebug(payload)),
    provider,
    route,
    stream: payload.stream ?? null,
    systemShape: sequenceSummary(payload.system),
    tools: toolSummary(payload.tools),
    turnShape: sequenceSummary(messages),
  };
};

export const debugProviderRequest = (params: {
  baseURL?: string;
  payload: Record<string, any>;
  provider: string;
  route: ProviderDebugRoute;
}) => {
  console.log('[provider-debug:request]', JSON.stringify(buildProviderDebugRequest(params)));
};
