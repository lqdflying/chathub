const CACHE_KEY_MODELS = ['gpt-5', 'codex'];

const trimLower = (value?: string) => String(value || '').trim().toLowerCase();

const objectValue = (value: unknown): Record<string, any> | null =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, any>) : null;

const cachedTokenNumber = (value: unknown): number | null => {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'number' && typeof value !== 'string') return null;

  const trimmed = typeof value === 'string' ? value.trim() : '';
  if (typeof value === 'string' && !trimmed) return null;

  const n = typeof value === 'number' ? value : Number(trimmed);
  if (!Number.isFinite(n) || n < 0) return null;

  return Math.trunc(n);
};

const canonicalize = (value: unknown): unknown => {
  if (value === undefined) return undefined;
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(canonicalize);

  const out: Record<string, unknown> = {};
  for (const key of Object.keys(value as Record<string, unknown>).sort()) {
    const v = canonicalize((value as Record<string, unknown>)[key]);
    if (v !== undefined) out[key] = v;
  }

  return out;
};

export const normalizeCompatSeedJSON = (value: unknown) => {
  if (value === undefined) return '';

  try {
    return JSON.stringify(canonicalize(value));
  } catch {
    return String(value);
  }
};

const sha256Hex = async (text: string, length = 32) => {
  const data = new TextEncoder().encode(text);
  const hash = await crypto.subtle.digest('SHA-256', data);

  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, length);
};

export const shouldAutoInjectPromptCacheKeyForCompat = (model?: string) => {
  const normalized = trimLower(model);

  return CACHE_KEY_MODELS.some((keyword) => normalized.includes(keyword));
};

const firstUserContentFromInput = (input: unknown) => {
  if (typeof input === 'string') return { label: 'input', value: input };
  if (!Array.isArray(input)) return null;

  for (const item of input) {
    if (!item || typeof item !== 'object') continue;
    const value = item as Record<string, any>;
    if (value.role === 'user') return { label: 'first_user', value: value.content };
    if (value.type === 'input_text') return { label: 'first_user', value: value.text || '' };
    if (value.type === 'message' && value.role === 'user')
      return { label: 'first_user', value: value.content };
  }

  return null;
};

const appendStableSeedParts = (parts: string[], parsedBody: Record<string, any>, model?: string) => {
  const normalizedModel = String(model || parsedBody.model || '').trim();
  if (normalizedModel) parts.push(`model=${normalizedModel}`);

  const effort = parsedBody.reasoning?.effort || parsedBody.reasoning_effort;
  if (effort) parts.push(`reasoning_effort=${String(effort).trim()}`);

  if (parsedBody.tool_choice !== undefined)
    parts.push(`tool_choice=${normalizeCompatSeedJSON(parsedBody.tool_choice)}`);
  if (Array.isArray(parsedBody.tools) && parsedBody.tools.length > 0)
    parts.push(`tools=${normalizeCompatSeedJSON(parsedBody.tools)}`);
  if (Array.isArray(parsedBody.functions) && parsedBody.functions.length > 0)
    parts.push(`functions=${normalizeCompatSeedJSON(parsedBody.functions)}`);
  if (typeof parsedBody.instructions === 'string' && parsedBody.instructions)
    parts.push(`instructions=${parsedBody.instructions}`);

  let firstUserCaptured = false;
  if (Array.isArray(parsedBody.messages)) {
    for (const msg of parsedBody.messages) {
      const role = String(msg?.role || '').trim();
      if (role === 'system' || role === 'developer') {
        parts.push(`${role}=${normalizeCompatSeedJSON(msg.content)}`);
      } else if (role === 'user' && !firstUserCaptured) {
        parts.push(`first_user=${normalizeCompatSeedJSON(msg.content)}`);
        firstUserCaptured = true;
      }
    }
  } else {
    if (Array.isArray(parsedBody.input)) {
      for (const item of parsedBody.input) {
        const role = String(item?.role || '').trim();
        if (role === 'system' || role === 'developer')
          parts.push(`${role}=${normalizeCompatSeedJSON(item.content)}`);
      }
    }

    const firstInput = firstUserContentFromInput(parsedBody.input);
    if (firstInput) parts.push(`${firstInput.label}=${normalizeCompatSeedJSON(firstInput.value)}`);
  }

  return parts;
};

export interface DeriveCompatPromptCacheKeyOptions {
  /**
   * When the user explicitly enabled cache hints via the `openAICompatCache`
   * matrix, the key must be derived for ANY model — the gpt-5/codex family
   * allowlist only applies to implicit/legacy injection paths.
   */
  bypassModelAllowlist?: boolean;
}

export const deriveCompatPromptCacheKey = async (
  parsedBody: Record<string, any>,
  model?: string,
  options?: DeriveCompatPromptCacheKeyOptions,
) => {
  if (!parsedBody) return '';
  if (
    !options?.bypassModelAllowlist &&
    !shouldAutoInjectPromptCacheKeyForCompat(model || parsedBody.model)
  )
    return '';

  const seedParts = appendStableSeedParts([], parsedBody, model);
  if (seedParts.length === 0) return '';

  return `compat_cc_${await sha256Hex(seedParts.join('|'), 32)}`;
};

export const openAICompatCachedTokens = (json: unknown) => {
  const body = objectValue(json);
  if (!body) return null;

  const usage = objectValue(body.usage);
  const standard = cachedTokenNumber(
    usage?.input_tokens_details?.cached_tokens ?? usage?.prompt_tokens_details?.cached_tokens,
  );
  if (standard !== null) return standard;

  const candidates = [
    usage?.cached_tokens,
    usage?.prompt_cache_hit_tokens,
    body.input_tokens_details?.cached_tokens,
    body.prompt_tokens_details?.cached_tokens,
  ];

  for (const candidate of candidates) {
    const n = cachedTokenNumber(candidate);
    if (n !== null) return n;
  }

  if (Array.isArray(body.choices)) {
    for (const choice of body.choices) {
      const n = cachedTokenNumber(choice?.usage?.cached_tokens);
      if (n !== null) return n;
    }
  }

  return cachedTokenNumber(body.timings?.cache_n);
};

export const normalizeOpenAICompatCacheUsage = <T>(json: T) => {
  const body = objectValue(json);
  if (!body) return { cachedTokens: null, changed: false, json };

  const cachedTokens = openAICompatCachedTokens(body);
  if (cachedTokens === null) return { cachedTokens: null, changed: false, json: body as T };

  if (!objectValue(body.usage)) body.usage = {};

  const hasResponseUsage =
    body.usage.input_tokens !== undefined ||
    body.input_tokens !== undefined ||
    body.usage.output_tokens !== undefined;

  const detailsKey = hasResponseUsage ? 'input_tokens_details' : 'prompt_tokens_details';
  if (!objectValue(body.usage[detailsKey])) body.usage[detailsKey] = {};

  if (body.usage[detailsKey].cached_tokens === cachedTokens) {
    return { cachedTokens, changed: false, json: body as T };
  }

  body.usage[detailsKey].cached_tokens = cachedTokens;

  return { cachedTokens, changed: true, json: body as T };
};
