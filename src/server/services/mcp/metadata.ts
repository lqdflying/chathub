/**
 * Model-boundary hygiene for MCP tool metadata (OpenClaw `mcp-metadata.ts`
 * pattern). Tool descriptions are server-controlled, untrusted text that lands
 * in the model's tools block verbatim, so classic prompt-injection imperatives
 * are redacted and the text is capped before a manifest is synthesized.
 */

/** Maximum length of a tool description exposed to the model. */
export const MCP_TOOL_DESCRIPTION_MAX_CHARS = 1200;

const REDACTED = '[redacted MCP metadata instruction]';

/**
 * Scrub untrusted MCP metadata text before exposing it to a model.
 * Returns '' for empty input so the `LobeChatPluginApi.description` contract
 * (required string) holds.
 */
export const sanitizeMcpToolDescription = (value: string | undefined): string => {
  const normalized = value?.trim();
  if (!normalized) return '';

  const scrubbed = normalized
    .replace(
      /ignore\s+(?:all\s+)?(?:previous|prior|above)\s+instructions/gi,
      REDACTED,
    )
    .replace(
      /disregard\s+(?:all\s+)?(?:previous|prior|above)\s+instructions/gi,
      REDACTED,
    )
    // Break up the literal phrase so downstream prompt-injection heuristics
    // keyed on "system prompt" do not fire on tool metadata.
    .replace(/system\s+prompt/gi, 'system prompt');

  return scrubbed.length > MCP_TOOL_DESCRIPTION_MAX_CHARS
    ? `${scrubbed.slice(0, MCP_TOOL_DESCRIPTION_MAX_CHARS)}...`
    : scrubbed;
};

/**
 * Strip protocol-level `_meta` from a callTool result before it is normalized
 * into model-facing content. `_meta` is reserved for MCP protocol metadata and
 * is not part of the tool's contract with the model.
 */
export const stripMcpResultMeta = <T>(value: T): T => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;

  const record = value as Record<string, unknown>;
  const stripped: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(record)) {
    if (key === '_meta') continue;
    // `content` items are protocol-level blocks; strip their `_meta` too.
    // `structuredContent` / parsed text are the tool's own data — untouched.
    stripped[key] =
      key === 'content' && Array.isArray(item)
        ? item.map((contentItem) => stripMcpResultMeta(contentItem))
        : item;
  }
  return stripped as T;
};
