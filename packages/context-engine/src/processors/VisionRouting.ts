import debug from 'debug';

import { BaseProcessor } from '../base/BaseProcessor';
import type { PipelineContext, ProcessorOptions } from '../types';

const log = debug('context-engine:processor:VisionRoutingProcessor');

const VISION_MODEL_ID = 'MiniMaxAI/MiniMax-VL-01';
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

const callVisionModel = async (
  imageUrl: string,
  apiKey: string,
  baseUrl: string,
): Promise<string> => {
  const url = `${baseUrl}/chat/completions`;

  const response = await fetch(url, {
    body: JSON.stringify({
      messages: [
        {
          content: [
            { image_url: { url: imageUrl }, type: 'image_url' },
            { text: VISION_PROMPT, type: 'text' },
          ],
          role: 'user',
        },
      ],
      model: VISION_MODEL_ID,
    }),
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    method: 'POST',
  });

  if (!response.ok) {
    throw new Error(`Vision API error: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content;
  return typeof content === 'string' ? content.trim() : '';
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
