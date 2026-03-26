# MiniMax Vision Routing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When MiniMax M2.7 is selected and user sends an image, call MiniMax-VL-01 to extract image description, inject as text, then continue normal MiniMax chat.

**Architecture:** A new `VisionRoutingProcessor` runs in the `contextEngineering` pipeline before `MessageContentProcessor`. It intercepts image-containing user messages when the selected model lacks vision, calls MiniMax-VL-01 via the `/v1/chat/completions` endpoint, and replaces image content with the extracted text description.

**Tech Stack:** TypeScript, `fetch` API, existing `BaseProcessor` pattern, `createPayloadWithKeyVaults` for API key access.

---

## File Map

| File                                                                     | Change                                              |
| ------------------------------------------------------------------------ | --------------------------------------------------- |
| `packages/context-engine/src/processors/VisionRouting.ts`                | **CREATE** — new processor                          |
| `packages/context-engine/src/processors/index.ts`                        | **MODIFY** — export new processor                   |
| `packages/context-engine/src/processors/__tests__/VisionRouting.test.ts` | **CREATE** — unit tests                             |
| `src/services/chat/contextEngineering.ts`                                | **MODIFY** — add VisionRoutingProcessor to pipeline |
| `src/services/chat/contextEngineering.test.ts`                           | **MODIFY** — add integration test                   |

---

## Task 1: Create VisionRoutingProcessor

**Files:**

- Create: `packages/context-engine/src/processors/VisionRouting.ts`

- Test: `packages/context-engine/src/processors/__tests__/VisionRouting.test.ts`

- [ ] **Step 1: Write the test file**

```typescript
// packages/context-engine/src/processors/__tests__/VisionRouting.test.ts
import { describe, expect, it, vi } from 'vitest';

import { VisionRoutingProcessor } from '../VisionRouting';

describe('VisionRoutingProcessor', () => {
  const mockIsCanUseVision = vi.fn();
  const mockGetApiKey = vi.fn().mockReturnValue('test-api-key');
  const mockGetBaseUrl = vi.fn().mockReturnValue('https://api.minimax.io/v1');

  const createProcessor = () =>
    new VisionRoutingProcessor({
      getApiKey: mockGetApiKey,
      getBaseUrl: mockGetBaseUrl,
      isCanUseVision: mockIsCanUseVision,
    });

  beforeEach(() => {
    vi.clearAllMocks();
    mockIsCanUseVision.mockReturnValue(false);
  });

  it('should skip routing when model supports vision', async () => {
    mockIsCanUseVision.mockReturnValue(true);
    const processor = createProcessor();
    const context = {
      initialState: { messages: [] },
      isAborted: false,
      messages: [
        {
          id: '1',
          role: 'user',
          content: 'What is this?',
          imageList: [{ id: 'img1', url: 'https://example.com/image.png' }],
        },
      ],
      metadata: {},
    };

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: 'A cat sitting on a table' } }],
      }),
    });

    const result = await processor.process(context as any);
    expect(global.fetch).not.toHaveBeenCalled();
    expect(result.messages[0].imageList).toHaveLength(1); // unchanged
  });

  it('should skip routing when no images', async () => {
    const processor = createProcessor();
    const context = {
      initialState: { messages: [] },
      isAborted: false,
      messages: [{ id: '1', role: 'user', content: 'Hello' }],
      metadata: {},
    };

    global.fetch = vi.fn();
    const result = await processor.process(context as any);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('should skip routing when api key is missing', async () => {
    mockGetApiKey.mockReturnValue(undefined);
    const processor = createProcessor();
    const context = {
      initialState: { messages: [] },
      isAborted: false,
      messages: [
        {
          id: '1',
          role: 'user',
          content: 'What is this?',
          imageList: [{ id: 'img1', url: 'https://example.com/image.png' }],
        },
      ],
      metadata: {},
    };

    global.fetch = vi.fn();
    const result = await processor.process(context as any);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('should call VL API and inject description', async () => {
    const processor = createProcessor();
    const context = {
      initialState: { messages: [] },
      isAborted: false,
      messages: [
        {
          id: '1',
          role: 'user',
          content: 'What is this?',
          imageList: [{ id: 'img1', url: 'https://example.com/image.png' }],
        },
      ],
      metadata: {},
    };

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: 'A cat sitting on a table' } }],
      }),
    });

    const result = await processor.process(context as any);

    expect(global.fetch).toHaveBeenCalledWith(
      'https://api.minimax.io/v1/chat/completions',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'Authorization': 'Bearer test-api-key',
          'Content-Type': 'application/json',
        }),
        body: expect.stringContaining('MiniMaxAI/MiniMax-VL-01'),
      }),
    );

    expect(result.messages[0].content).toBe(
      'What is this?\n\n[Image description: A cat sitting on a table]',
    );
    expect(result.messages[0].imageList).toHaveLength(0);
  });

  it('should handle VL API failure gracefully', async () => {
    const processor = createProcessor();
    const context = {
      initialState: { messages: [] },
      isAborted: false,
      messages: [
        {
          id: '1',
          role: 'user',
          content: 'What is this?',
          imageList: [{ id: 'img1', url: 'https://example.com/image.png' }],
        },
      ],
      metadata: {},
    };

    global.fetch = vi.fn().mockRejectedValue(new Error('Network error'));

    const result = await processor.process(context as any);

    // Should continue without image
    expect(result.messages[0].content).toBe('What is this?');
    expect(result.messages[0].imageList).toHaveLength(1); // still present
  });

  it('should only process user messages', async () => {
    const processor = createProcessor();
    const context = {
      initialState: { messages: [] },
      isAborted: false,
      messages: [
        {
          id: '1',
          role: 'user',
          content: 'What is this?',
          imageList: [{ id: 'img1', url: 'https://example.com/image.png' }],
        },
        {
          id: '2',
          role: 'assistant',
          content: 'I see a cat',
          imageList: [{ id: 'img2', url: 'https://example.com/image2.png' }],
        },
      ],
      metadata: {},
    };

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: 'A cat' } }],
      }),
    });

    await processor.process(context as any);

    // Only user message should trigger fetch
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails (VisionRouting not exported yet)**

Run: `cd /home/opc/lobehub && bunx vitest run --silent='passed-only' 'packages/context-engine/src/processors/__tests__/VisionRouting.test.ts'`
Expected: FAIL — module not found

- [ ] **Step 3: Write the VisionRoutingProcessor**

```typescript
// packages/context-engine/src/processors/VisionRouting.ts
import debug from 'debug';

import { BaseProcessor } from '../base/BaseProcessor';
import type { PipelineContext, ProcessorOptions } from '../types';

const log = debug('context-engine:processor:VisionRoutingProcessor');

const VISION_MODEL_ID = 'MiniMaxAI/MiniMax-VL-01';
const VISION_PROMPT =
  'Describe this image in detail. Include any text, charts, diagrams, or important visual elements.';

export interface VisionRoutingConfig {
  /** Check if the current model supports vision */
  isCanUseVision: (model: string, provider: string) => boolean;
  /** Extract the API key for the provider */
  getApiKey: (provider: string) => string | undefined;
  /** Extract the base URL for the provider */
  getBaseUrl: (provider: string) => string | undefined;
  /** Current model ID */
  model: string;
  /** Current provider ID */
  provider: string;
}

interface ImageItem {
  id: string;
  url: string;
  alt?: string;
}

const callVisionModel = async (
  imageUrl: string,
  apiKey: string,
  baseUrl: string,
): Promise<string> => {
  const url = `${baseUrl}/chat/completions`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: VISION_MODEL_ID,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'image_url', image_url: { url: imageUrl } },
            { type: 'text', text: VISION_PROMPT },
          ],
        },
      ],
    }),
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /home/opc/lobehub && bunx vitest run --silent='passed-only' 'packages/context-engine/src/processors/__tests__/VisionRouting.test.ts'`
Expected: PASS

- [ ] **Step 5: Export from index.ts**

Modify `packages/context-engine/src/processors/index.ts` — add after line 9:

```typescript
export { VisionRoutingProcessor } from './VisionRouting';
export type { VisionRoutingConfig } from './VisionRouting';
```

Run: `cd /home/opc/lobehub && bunx vitest run --silent='passed-only' 'packages/context-engine/src/processors/__tests__/VisionRouting.test.ts'`
Expected: PASS (still)

- [ ] **Step 6: Commit**

```bash
git add packages/context-engine/src/processors/VisionRouting.ts packages/context-engine/src/processors/__tests__/VisionRouting.test.ts packages/context-engine/src/processors/index.ts
git commit -m "feat(context-engine): add VisionRoutingProcessor for MiniMax image extraction"
```

---

## Task 2: Add VisionRoutingProcessor to contextEngineering Pipeline

**Files:**

- Modify: `src/services/chat/contextEngineering.ts`

- Test: `src/services/chat/contextEngineering.test.ts`

- [ ] **Step 1: Read current contextEngineering.ts to understand exact line numbers**

The pipeline starts at line 88 with `new ContextEngine({`. VisionRoutingProcessor should be inserted between PlaceholderVariablesProcessor (step 7) and MessageContentProcessor (step 8).

- [ ] **Step 2: Import VisionRoutingProcessor**

Add to imports from `@lobechat/context-engine` (line 2-16) — actually it needs to be imported separately since it's in a separate package.

Add after line 26:

```typescript
import { VisionRoutingProcessor } from '@lobechat/context-engine';
```

- [ ] **Step 3: Add getApiKey and getBaseUrl functions**

These use the existing auth infrastructure. Add after the `resolveProxyImageUrls` function (after line 57):

```typescript
/** Get the API key for a provider from the user key vaults */
const getProviderApiKey = (provider: string): string | undefined => {
  // TODO: remove isDeprecatedEdition condition in V2.0
  if (isDeprecatedEdition) {
    return undefined; // Not supported in deprecated edition
  }
  const keyVaults = aiProviderSelectors.providerKeyVaults(provider)(getAiInfraStoreState());
  return keyVaults?.apiKey;
};

/** Get the base URL for a provider from the user key vaults */
const getProviderBaseUrl = (provider: string): string | undefined => {
  // TODO: remove isDeprecatedEdition condition in V2.0
  if (isDeprecatedEdition) {
    return undefined;
  }
  const keyVaults = aiProviderSelectors.providerKeyVaults(provider)(getAiInfraStoreState());
  return keyVaults?.baseURL || 'https://api.minimax.io/v1';
};
```

Add imports needed for these:

```typescript
import { isDeprecatedEdition } from '@/const/version';
import { aiProviderSelectors, getAiInfraStoreState } from '@/store/aiInfra';
```

- [ ] **Step 4: Add VisionRoutingProcessor to pipeline**

In the `pipeline:` array (line 89+), add after PlaceholderVariablesProcessor (step 7):

```typescript
// 8. Vision routing (before MessageContentProcessor — must run before image content is processed)
new VisionRoutingProcessor({
  getApiKey: getProviderApiKey,
  getBaseUrl: getProviderBaseUrl,
  isCanUseVision,
  model,
  provider,
}),
```

- [ ] **Step 5: Run type check**

Run: `cd /home/opc/lobehub && bun run type-check:tsc 2>&1 | head -30`
Expected: No errors related to VisionRouting

- [ ] **Step 6: Commit**

```bash
git add src/services/chat/contextEngineering.ts
git commit -m "feat(chat): add VisionRoutingProcessor to contextEngineering pipeline"
```

---

## Task 3: Add Integration Test

**Files:**

- Modify: `src/services/chat/contextEngineering.test.ts`

- [ ] **Step 1: Add test for vision routing with MiniMax**

Add a new describe block to the existing test file:

```typescript
describe('vision routing for MiniMax', () => {
  beforeEach(() => {
    isServerMode = true;
  });

  it('should extract image description via MiniMax-VL-01 when model lacks vision', async () => {
    // Mock isCanUseVision to return false for MiniMax
    vi.spyOn(helpers, 'isCanUseVision').mockReturnValue(false);

    // Mock the VL API call
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: 'A terminal showing git worktree removal commands' } }],
      }),
    });

    // Mock getProviderApiKey and getProviderBaseUrl
    vi.spyOn(helpers, 'getProviderApiKey').mockReturnValue('test-minimax-key');
    vi.spyOn(helpers, 'getProviderBaseUrl').mockReturnValue('https://api.minimax.io/v1');

    const messages = [
      {
        id: '1',
        role: 'user' as const,
        content: 'What do you see?',
        imageList: [{ id: 'img1', url: 'https://example.com/terminal.png' }],
      },
    ];

    const result = await contextEngineering({
      messages,
      model: 'MiniMax-M2.7',
      provider: 'minimax',
    });

    // Verify VL was called
    expect(global.fetch).toHaveBeenCalledWith(
      'https://api.minimax.io/v1/chat/completions',
      expect.objectContaining({
        body: expect.stringContaining('MiniMaxAI/MiniMax-VL-01'),
      }),
    );

    // Verify description was injected
    expect(result[0].content).toContain('A terminal showing git worktree removal commands');
  });

  it('should skip vision routing when model supports vision', async () => {
    vi.spyOn(helpers, 'isCanUseVision').mockReturnValue(true);

    const messages = [
      {
        id: '1',
        role: 'user' as const,
        content: 'What do you see?',
        imageList: [{ id: 'img1', url: 'https://example.com/terminal.png' }],
      },
    ];

    await contextEngineering({
      messages,
      model: 'MiniMax-M2.7',
      provider: 'minimax',
    });

    // VL should not be called when model supports vision
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
```

Note: The `getProviderApiKey` and `getProviderBaseUrl` are local functions in contextEngineering.ts. For the test to mock them properly, the implementation should use a function that's imported from `./helper.ts` so it can be spied. If they remain as local module functions, use `vi.mock` or refactor them to helper.ts.

- [ ] **Step 2: Run test**

Run: `cd /home/opc/lobehub && bunx vitest run --silent='passed-only' 'src/services/chat/contextEngineering.test.ts' -t 'vision routing'`
Expected: PASS (may need adjustment based on actual module structure)

- [ ] **Step 3: Commit**

```bash
git add src/services/chat/contextEngineering.test.ts
git commit -m "test(chat): add vision routing integration test"
```

---

## Verification

After all tasks complete, run the full test suite:

```bash
cd /home/opc/lobehub
bunx vitest run --silent='passed-only' 'packages/context-engine/src/processors/__tests__/VisionRouting.test.ts'
bunx vitest run --silent='passed-only' 'src/services/chat/contextEngineering.test.ts'
bun run type-check:tsc 2>&1 | tail -5
```
