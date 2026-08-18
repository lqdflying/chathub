export const conversationGenerationIdempotencyKey = (
  ...parts: Array<string | number | null | undefined>
) => {
  const raw = parts.map((part) => (part == null || part === '' ? 'none' : String(part))).join(':');
  if (raw.length >= 8 && raw.length <= 180) return raw;
  if (raw.length < 8) return `${raw}:xxxxxxxx`.slice(0, 8);

  let hash = 2_166_136_261;
  for (let index = 0; index < raw.length; index += 1) {
    hash ^= raw.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  const digest = (hash >>> 0).toString(16).padStart(8, '0');
  return `${raw.slice(0, 160)}:${digest}`.slice(0, 180);
};
