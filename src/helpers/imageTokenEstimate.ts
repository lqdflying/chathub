import type { ChatImageItem, UIChatMessage } from '@lobechat/types';

/**
 * Image token allowances follow the vendor vision guides.
 * OpenAI: https://developers.openai.com/api/docs/guides/images-vision
 * Claude: https://platform.claude.com/docs/en/build-with-claude/vision
 * Remote URLs are not fetched. Unknown models and unreadable images use a fixed allowance.
 */
export const IMAGE_TOKEN_FALLBACK = 8192;

export type ImageTokenConfidence = 'documented' | 'heuristic';

export interface ImageSize {
  height: number;
  width: number;
}

export interface VisualTokenEstimate {
  confidence: ImageTokenConfidence;
  hasVisual: boolean;
  tokens: number;
}

const DATA_IMAGE =
  /data:image\/(?:png|jpeg|jpg|gif|webp);base64,[a-zA-Z0-9+/=\s]+/gi;

export const stripInlineImagePayloads = (text: string): string =>
  text.replace(DATA_IMAGE, '[image]');

const decodeDataUrl = (url: string): Uint8Array | undefined => {
  const match = /^data:image\/(?:png|jpeg|jpg|gif|webp);base64,([a-zA-Z0-9+/=\s]+)$/i.exec(
    url.trim(),
  );
  if (!match?.[1]) return undefined;
  try {
    const binary = atob(match[1].replace(/\s/g, ''));
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
  } catch {
    return undefined;
  }
};

const readU16 = (bytes: Uint8Array, offset: number, littleEndian: boolean): number | undefined => {
  if (offset + 1 >= bytes.length) return undefined;
  return littleEndian
    ? bytes[offset]! + (bytes[offset + 1]! << 8)
    : (bytes[offset]! << 8) + bytes[offset + 1]!;
};

const readU32 = (bytes: Uint8Array, offset: number): number | undefined => {
  if (offset + 3 >= bytes.length) return undefined;
  return (
    bytes[offset]! * 16_777_216 +
    ((bytes[offset + 1]! << 16) | (bytes[offset + 2]! << 8) | bytes[offset + 3]!)
  );
};

const readPngSize = (bytes: Uint8Array): ImageSize | undefined => {
  if (bytes.length < 24 || bytes[0] !== 0x89 || bytes[1] !== 0x50) return undefined;
  const width = readU32(bytes, 16);
  const height = readU32(bytes, 20);
  if (!width || !height) return undefined;
  return { height, width };
};

const readGifSize = (bytes: Uint8Array): ImageSize | undefined => {
  if (bytes.length < 10 || bytes[0] !== 0x47 || bytes[1] !== 0x49) return undefined;
  const width = readU16(bytes, 6, true);
  const height = readU16(bytes, 8, true);
  if (!width || !height) return undefined;
  return { height, width };
};

const readJpegSize = (bytes: Uint8Array): ImageSize | undefined => {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return undefined;
  let offset = 2;
  while (offset + 8 < bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = bytes[offset + 1]!;
    if (marker === 0xc0 || marker === 0xc1 || marker === 0xc2) {
      const height = readU16(bytes, offset + 5, false);
      const width = readU16(bytes, offset + 7, false);
      if (!width || !height) return undefined;
      return { height, width };
    }
    const length = readU16(bytes, offset + 2, false);
    if (!length || length < 2) return undefined;
    offset += 2 + length;
  }
  return undefined;
};

const readWebpSize = (bytes: Uint8Array): ImageSize | undefined => {
  if (bytes.length < 30 || bytes[0] !== 0x52 || bytes[8] !== 0x57) return undefined;
  const chunk = String.fromCharCode(bytes[12]!, bytes[13]!, bytes[14]!, bytes[15]!);
  if (chunk === 'VP8X' && bytes.length >= 30) {
    const width = 1 + bytes[24]! + (bytes[25]! << 8) + (bytes[26]! << 16);
    const height = 1 + bytes[27]! + (bytes[28]! << 8) + (bytes[29]! << 16);
    if (width > 0 && height > 0) return { height, width };
  }
  return undefined;
};

export const readImageSize = (bytes: Uint8Array): ImageSize | undefined =>
  readPngSize(bytes) || readGifSize(bytes) || readJpegSize(bytes) || readWebpSize(bytes);

const fit = (size: ImageSize, longEdge: number): ImageSize => {
  const scale = Math.min(1, longEdge / Math.max(size.width, size.height));
  return {
    height: Math.max(1, Math.floor(size.height * scale)),
    width: Math.max(1, Math.floor(size.width * scale)),
  };
};

const patchCount = (size: ImageSize, patch: number): number =>
  Math.ceil(size.width / patch) * Math.ceil(size.height / patch);

const fitPatchBudget = (size: ImageSize, patch: number, budget: number): ImageSize => {
  if (patchCount(size, patch) <= budget) return size;
  let low = 0;
  let high = 1;
  for (let step = 0; step < 24; step += 1) {
    const scale = (low + high) / 2;
    const candidate = {
      height: Math.max(1, Math.floor(size.height * scale)),
      width: Math.max(1, Math.floor(size.width * scale)),
    };
    if (patchCount(candidate, patch) <= budget) low = scale;
    else high = scale;
  }
  return {
    height: Math.max(1, Math.floor(size.height * low)),
    width: Math.max(1, Math.floor(size.width * low)),
  };
};

type ImageProfile = 'openai-patches' | 'openai-tiles' | 'claude-standard' | 'claude-high' | 'unknown';

const imageProfile = (modelId: string): ImageProfile => {
  const model = modelId.toLowerCase();
  if (/^(gpt-6|gpt-5\.[2-9]|gpt-4\.1-mini)/.test(model)) return 'openai-patches';
  if (/^(gpt-4o|gpt-4\.1|gpt-5\.1)(?:-|$)/.test(model)) return 'openai-tiles';
  if (/^claude-/.test(model)) {
    return /claude-(?:opus|sonnet|haiku)-(?:[5-9]|4-(?:[5-9]|1\d))/.test(model)
      ? 'claude-high'
      : 'claude-standard';
  }
  return 'unknown';
};

const documentedImageTokens = (size: ImageSize, profile: ImageProfile, modelId: string): number => {
  const model = modelId.toLowerCase();
  if (profile === 'openai-patches') {
    const resized = fitPatchBudget(fit(size, 2048), 32, model.startsWith('gpt-4.1-mini') ? 1536 : 2500);
    const multiplier = model.startsWith('gpt-4.1-mini') ? 1.62 : 1.2;
    return Math.ceil(patchCount(resized, 32) * multiplier);
  }
  if (profile === 'openai-tiles') {
    const base = model.startsWith('gpt-4o-mini') ? 2833 : model.startsWith('gpt-5.1') ? 70 : 85;
    const perTile = model.startsWith('gpt-4o-mini') ? 5667 : model.startsWith('gpt-5.1') ? 140 : 170;
    let resized = fit(size, 2048);
    const shortEdge = Math.min(resized.width, resized.height);
    if (shortEdge > 768) {
      const scale = 768 / shortEdge;
      resized = {
        height: Math.max(1, Math.floor(resized.height * scale)),
        width: Math.max(1, Math.floor(resized.width * scale)),
      };
    }
    return base + patchCount(resized, 512) * perTile;
  }
  const high = profile === 'claude-high';
  const resized = fitPatchBudget(fit(size, high ? 2576 : 1568), 28, high ? 4784 : 1568);
  return patchCount(resized, 28);
};

export const estimateImageTokens = (
  url: string | undefined,
  modelId = '',
): { confidence: ImageTokenConfidence; tokens: number } => {
  const profile = imageProfile(modelId);
  const bytes = url?.startsWith('data:') ? decodeDataUrl(url) : undefined;
  const size = bytes ? readImageSize(bytes) : undefined;
  if (!size || profile === 'unknown') {
    return { confidence: 'heuristic', tokens: IMAGE_TOKEN_FALLBACK };
  }
  return { confidence: 'documented', tokens: documentedImageTokens(size, profile, modelId) };
};

const listedImageUrls = (message: Pick<UIChatMessage, 'content' | 'imageList'>): string[] => {
  const listed = (message.imageList ?? [])
    .map((item: ChatImageItem) => item.url)
    .filter((url): url is string => !!url);
  if (listed.length) return listed;
  const content = typeof message.content === 'string' ? message.content : '';
  return content.match(DATA_IMAGE) ?? [];
};

export const estimateMessageVisualTokens = (
  message: Pick<UIChatMessage, 'content' | 'imageList' | 'videoList'>,
  modelId = '',
): VisualTokenEstimate => {
  const images = listedImageUrls(message);
  const videos = message.videoList?.length ?? 0;
  if (!images.length && !videos) {
    return { confidence: 'heuristic', hasVisual: false, tokens: 0 };
  }

  let tokens = 0;
  let confidence: ImageTokenConfidence = 'documented';
  for (const url of images) {
    const estimated = estimateImageTokens(url, modelId);
    tokens += estimated.tokens;
    if (estimated.confidence === 'heuristic') confidence = 'heuristic';
  }
  if (videos) {
    tokens += videos * IMAGE_TOKEN_FALLBACK;
    confidence = 'heuristic';
  }
  return { confidence, hasVisual: true, tokens };
};
