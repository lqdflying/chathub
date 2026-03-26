# MiniMax Vision Routing Design

## Context

MiniMax M2.7 (the default MiniMax chat model) does not support vision/image input. When a user selects MiniMax M2.7 and sends a message containing images, the images are silently dropped — `MessageContentProcessor` checks `isCanUseVision()` which returns `false` for MiniMax, and skips image processing entirely.

MiniMax provides a separate vision-capable model: **MiniMax-VL-01**. This design implements automatic routing so that when MiniMax M2.7 is selected with images, MiniMax-VL-01 extracts image descriptions that are injected as text into the chat.

## Approach

Insert a new processor into the `contextEngineering` pipeline that intercepts image-containing messages before `MessageContentProcessor` runs. The processor:

1. Detects images in user messages when the selected model lacks vision
2. Calls MiniMax-VL-01 to extract a text description of each image
3. Replaces the image content with the extracted description text
4. Removes the image from `imageList` so downstream processors don't re-process it

Pipeline order after change:

1. HistoryTruncateProcessor
2. SystemRoleInjector
3. InboxGuideProvider
4. ToolSystemRoleProvider
5. HistorySummaryProvider
6. InputTemplateProcessor
7. PlaceholderVariablesProcessor
8. **VisionRoutingProcessor** (NEW — before MessageContentProcessor)
9. MessageContentProcessor
10. ToolCallProcessor
11. ToolMessageReorder
12. MessageCleanupProcessor

## API Details

| Item          | Value                                                                                              |
| ------------- | -------------------------------------------------------------------------------------------------- |
| Endpoint      | `https://api.minimax.io/v1/chat/completions`                                                       |
| Model ID      | `MiniMaxAI/MiniMax-VL-01`                                                                          |
| Auth          | Bearer token — same `MINIMAX_API_KEY` as MiniMax chat                                              |
| Vision prompt | "Describe this image in detail. Include any text, charts, diagrams, or important visual elements." |

### Request Format

```json
{
  "messages": [
    {
      "role": "user",
      "content": [
        { "type": "image_url", "image_url": { "url": "https://..." } },
        { "type": "text", "text": "Describe this image in detail..." }
      ]
    }
  ],
  "model": "MiniMaxAI/MiniMax-VL-01"
}
```

### Response Handling

Extract `choices[0].message.content` — the text description — and prepend it to the message content with a prefix: `"[Image description: <desc>] "`.

## Processor Interface

```typescript
// packages/context-engine/src/processors/VisionRouting.ts

interface VisionRoutingConfig {
  /** Check if the current model supports vision */
  isCanUseVision: (model: string, provider: string) => boolean;
  /** Extract the API key for the provider */
  getApiKey: (provider: string) => string | undefined;
  /** Extract the base URL for the provider */
  getBaseUrl: (provider: string) => string | undefined;
}
```

## Error Handling

- If MiniMax API key is missing → skip routing, log warning, continue without image
- If VL API call fails → log error, skip image, continue chat without it
- If VL response is empty → skip image, continue
- Timeout: 30 seconds per image

## Data Flow

**Before routing:**

```
User message: { content: "What do you see?", imageList: [{url: "https://..."}] }
```

**After VisionRoutingProcessor:**

```
User message: { content: "What do you see?\n\n[Image description: A terminal showing git worktree removal commands...]", imageList: [] }
```

**After MessageContentProcessor (normal path):**

```
User message: { content: "What do you see?\n\n[Image description: ...]", role: "user" }
```

## Files to Create/Modify

| File                                                      | Change                                 |
| --------------------------------------------------------- | -------------------------------------- |
| `packages/context-engine/src/processors/VisionRouting.ts` | New processor                          |
| `packages/context-engine/src/processors/index.ts`         | Export new processor                   |
| `src/services/chat/contextEngineering.ts`                 | Add VisionRoutingProcessor to pipeline |

## Testing Considerations

- Mock MiniMax VL API responses
- Test with single image and multiple images
- Test graceful degradation when VL API returns error
- Test that non-MiniMax providers are not affected
