import debug from 'debug';

import { BaseProcessor } from '../base/BaseProcessor';
import type { PipelineContext, ProcessorOptions } from '../types';

const log = debug('context-engine:processor:VisionRoutingProcessor');

const VISION_PROMPT =
  'Describe this image in detail. Include any text, charts, diagrams, or important visual elements.';

export interface VisionRoutingConfig {
  /** Extract the API key for the provider */
  getApiKey: (provider: string) => string | undefined;
  /** Extract the base URL for the provider */
  getBaseUrl: (provider: string) => string | undefined;
  /** Check if the current model supports vision */
  isCanUseVision: (model: string, provider: string) => boolean;
  /** Current model ID */
  model: string;
  /** Current provider ID */
  provider: string;
}

interface ImageItem {
  alt?: string;
  id: string;
  url: string;
}

/**
 * Fetch an image and convert it to a base64 data URL.
 * Supports http(s) URLs and data URLs.
 */
const fetchImageAsDataUrl = async (imageUrl: string): Promise<string> => {
  // If already a data URL, return as-is
  if (imageUrl.trim().startsWith('data:')) {
    log('Image URL is already a data URL');
    return imageUrl.trim();
  }

  log('Fetching image from URL: %s', imageUrl);
  const response = await fetch(imageUrl);
  if (!response.ok) {
    log.extend('error')('Failed to fetch image: %s %s', response.status, response.statusText);
    throw new Error(`Failed to fetch image: ${response.status} ${response.statusText}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  const contentType = response.headers.get('content-type') || 'image/jpeg';
  const sizeKb = Math.round(buffer.length / 1024);

  log('Fetched image: contentType=%s, size=%dKB', contentType, sizeKb);
  return `data:${contentType};base64,${buffer.toString('base64')}`;
};

/**
 * Call MiniMax VL endpoint to get image description.
 * MiniMax VL uses /v1/coding_plan/vlm (NOT /v1/chat/completions).
 * The image must be sent as a base64 data URL.
 */
const callVisionModel = async (
  imageUrl: string,
  apiKey: string,
  baseUrl: string,
): Promise<string> => {
  const dataUrl = await fetchImageAsDataUrl(imageUrl);
  const dataUrlSizeKb = Math.round(Buffer.from(dataUrl).length / 1024);
  log('Calling VL API with dataUrl size: %dKB', dataUrlSizeKb);

  const url = `${baseUrl}/coding_plan/vlm`;

  const response = await fetch(url, {
    body: JSON.stringify({
      image_url: dataUrl,
      prompt: VISION_PROMPT,
    }),
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      // MiniMax API requires this header to identify the calling service
      'MM-API-Source': 'LobeHub',
    },
    method: 'POST',
  });

  if (!response.ok) {
    const text = await response.text();
    log.extend('error')(
      'VL API error: %s %s, body: %s',
      response.status,
      response.statusText,
      text,
    );
    throw new Error(`Vision API error: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();

  // MiniMax VL response: { base_resp: { status_code: 0, status_msg: "success" }, content: "..." }
  // Check API-level status code (separate from HTTP status)
  const baseResp = data.base_resp as { status_code?: number; status_msg?: string } | undefined;
  const apiCode = baseResp?.status_code;
  if (apiCode !== undefined && apiCode !== 0) {
    const msg = baseResp?.status_msg?.trim() || 'Unknown error';
    log.extend('error')('VL API error: code=%d, msg=%s', apiCode, msg);
    throw new Error(`Vision API error (${apiCode}): ${msg}`);
  }

  const content = data.content?.trim();
  if (!content) {
    log.extend('error')('VL API returned empty content, full response: %s', JSON.stringify(data));
    throw new Error('Vision API returned empty content');
  }

  log('VL API description: %s', content.slice(0, 100));
  return content;
};

export class VisionRoutingProcessor extends BaseProcessor {
  readonly name = 'VisionRoutingProcessor';

  constructor(
    private config: VisionRoutingConfig,
    options: ProcessorOptions = {},
  ) {
    super(options);
  }

  protected async doProcess(context: PipelineContext): Promise<PipelineContext> {
    const clonedContext = this.cloneContext(context);

    const { model, provider, isCanUseVision, getApiKey, getBaseUrl } = this.config;

    // Skip if model already supports vision
    if (isCanUseVision(model, provider)) {
      log('Model %s supports vision, skipping routing', model);
      return this.markAsExecuted(clonedContext);
    }

    const apiKey = getApiKey(provider);
    const baseUrl = getBaseUrl(provider);

    if (!apiKey) {
      log('No API key for provider %s, skipping vision routing', provider);
      return this.markAsExecuted(clonedContext);
    }

    let processedCount = 0;

    for (let i = 0; i < clonedContext.messages.length; i++) {
      const message = clonedContext.messages[i];

      // Only process user messages with images
      if (message.role !== 'user') continue;

      const imageList: ImageItem[] = message.imageList;
      if (!imageList?.length) continue;

      log('Processing %d images for message %s', imageList.length, message.id);

      try {
        const descriptions = await Promise.all(
          imageList.map((img) => callVisionModel(img.url, apiKey, baseUrl!)),
        );

        // Build description text
        const descriptionText = descriptions
          .filter(Boolean)
          .map((desc, idx) => `[Image ${idx + 1} description: ${desc}]`)
          .join('\n\n');

        // Inject description into content
        const originalContent = typeof message.content === 'string' ? message.content : '';
        clonedContext.messages[i] = {
          ...message,
          content: descriptionText
            ? `${originalContent ? originalContent + '\n\n' : ''}${descriptionText}`
            : originalContent,
          imageList: [], // clear images so MessageContentProcessor doesn't re-process
        };

        processedCount++;
        log('Injected vision descriptions for message %s', message.id);
      } catch (error) {
        // Graceful degradation: log error and continue without image
        log.extend('error')('Vision routing failed for message %s: %s', message.id, error);
      }
    }

    clonedContext.metadata.visionRoutingProcessed = processedCount;
    log('Vision routing completed, processed %d messages', processedCount);

    return this.markAsExecuted(clonedContext);
  }
}
