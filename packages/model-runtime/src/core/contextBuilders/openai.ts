import { imageUrlToBase64 } from '@lobechat/utils';
import OpenAI, { toFile } from 'openai';

import { disableStreamModels, systemToUserModels } from '../../const/models';
import { ChatStreamPayload, OpenAIChatMessage } from '../../types';
import { parseDataUri } from '../../utils/uriParser';

export const convertMessageContent = async (
  content: OpenAI.ChatCompletionContentPart,
): Promise<OpenAI.ChatCompletionContentPart> => {
  if (content.type === 'image_url') {
    const { type } = parseDataUri(content.image_url.url);

    if (type === 'url' && process.env.LLM_VISION_IMAGE_USE_BASE64 === '1') {
      const { base64, mimeType } = await imageUrlToBase64(content.image_url.url);

      return {
        ...content,
        image_url: { ...content.image_url, url: `data:${mimeType};base64,${base64}` },
      };
    }
  }

  return content;
};

/**
 * Convert ChatCompletion messages for the OpenAI-compatible Chat Completions path.
 *
 * @param messages - The raw messages from the payload.
 * @param provider - The runtime provider id (e.g. `openai`, `openaicompatible`,
 *   `deepseek`, `moonshot`). When `openaicompatible`, the DeepSeek-specific
 *   `reasoning_content` field is NOT injected into assistant messages because it
 *   is not part of the OpenAI Chat Completions schema and can pollute the
 *   prompt-cache key on strict gateways. All other providers keep the existing
 *   behavior so DeepSeek/Moonshot multi-turn reasoning continuity is preserved.
 */
export const convertOpenAIMessages = async (
  messages: OpenAI.ChatCompletionMessageParam[],
  provider?: string,
) => {
  const skipReasoningContent = provider === 'openaicompatible';

  return (await Promise.all(
    messages.map(async (message) => {
      const msg = message as any;

      // `typeof null === 'object'` — tool-only assistant turns often use `content: null`.
      // Treating null like an array produced `content: []` and broke providers (e.g. Moonshot
      // Kimi: "reasoning_content is missing in assistant tool call message").
      const rawContent = msg.content;
      let normalizedContent: OpenAI.ChatCompletionMessageParam['content'];
      if (rawContent === null || rawContent === undefined) {
        normalizedContent = rawContent;
      } else if (typeof rawContent === 'string') {
        normalizedContent = rawContent;
      } else if (Array.isArray(rawContent)) {
        normalizedContent = await Promise.all(
          rawContent.map((c) =>
            convertMessageContent(c as OpenAI.ChatCompletionContentPart),
          ),
        );
      } else {
        normalizedContent = rawContent;
      }

      // Explicitly map only valid ChatCompletionMessageParam fields
      // Exclude reasoning and reasoning_content fields as they should not be sent in requests
      const result: any = {
        content: normalizedContent,
        role: msg.role,
      };

      // Add optional fields if they exist
      if (msg.name !== undefined) result.name = msg.name;
      if (msg.tool_calls !== undefined) result.tool_calls = msg.tool_calls;
      if (msg.tool_call_id !== undefined) result.tool_call_id = msg.tool_call_id;
      if (msg.function_call !== undefined) result.function_call = msg.function_call;

      // `reasoning_content` is a DeepSeek/Moonshot-specific field. For the
      // `openaicompatible` provider (gpt-5.5 etc.), skip it entirely so it does
      // not leak into the gateway request and pollute the prompt-cache key.
      if (!skipReasoningContent) {
        // it's compatible for DeepSeek
        if (msg.reasoning_content !== undefined) result.reasoning_content = msg.reasoning_content;

        // DeepSeek returns reasoning in stream deltas as reasoning_content, but the frontend
        // stores it as msg.reasoning.content. Map it back so multi-turn / tool-calling
        // conversations preserve the reasoning chain (only when reasoning_content is absent).
        if (result.reasoning_content === undefined && msg.reasoning?.content !== undefined)
          result.reasoning_content = msg.reasoning.content;
      }

      return result;
    }),
  )) as OpenAI.ChatCompletionMessageParam[];
};

/**
 * Convert Chat Completions content to Responses assistant easy-input content.
 * Non-text parts are dropped because historical assistant messages cannot
 * contain user input images in this serializer.
 */
function toResponseAssistantTextContent(content: OpenAIChatMessage['content']): string {
  if (typeof content === 'string') return content;

  if (Array.isArray(content)) {
    return content
      .filter((c) => c.type === 'text')
      .map((c) => (c as OpenAI.ChatCompletionContentPartText).text)
      .join('');
  }

  return '';
}

/**
 * Convert user message content (string or parts) to Responses easy-input
 * content, normalizing `input_text` and `input_image` parts (preserving image
 * `detail` and converting image URLs as needed).
 */
async function toResponseInputContentAsync(
  content: OpenAIChatMessage['content'],
): Promise<string | OpenAI.Responses.ResponseInputMessageContentList> {
  if (typeof content === 'string' || content === null || content === undefined) {
    return content ?? '';
  }

  if (!Array.isArray(content)) return content as any;

  return Promise.all(
    content.map(async (c) => {
      if (c.type === 'text') {
        return { text: (c as OpenAI.ChatCompletionContentPartText).text, type: 'input_text' };
      }

      if (c.type === 'image_url') {
        const image = (await convertMessageContent(
          c as OpenAI.ChatCompletionContentPartImage,
        )) as OpenAI.ChatCompletionContentPartImage;
        const part: OpenAI.Responses.ResponseInputImage = {
          detail: image.image_url?.detail ?? 'auto',
          image_url: image.image_url?.url,
          type: 'input_image',
        };
        return part;
      }

      // Drop unsupported part types rather than leaking Chat-Completions shapes.
      return null;
    }),
  ).then((parts) =>
    parts.filter((p): p is OpenAI.Responses.ResponseInputContent => p !== null),
  ) as OpenAI.Responses.ResponseInputMessageContentList;
}

export const convertOpenAIResponseInputs = async (
  messages: OpenAIChatMessage[],
  provider?: string,
) => {
  // Mirror convertOpenAIMessages: for the generic `openaicompatible` provider,
  // historical reasoning must not be serialized into the upstream `input` — it
  // perturbs the Responses cache prefix and strict gateways reject it.
  const skipReasoningContent = provider === 'openaicompatible';

  const groups = await Promise.all(
    messages.map(async (message): Promise<OpenAI.Responses.ResponseInputItem[]> => {
      const items: OpenAI.Responses.ResponseInputItem[] = [];

      // if message has reasoning, prepend it as a separate reasoning item
      if (!skipReasoningContent && message.reasoning?.content) {
        items.push({
          summary: [{ text: message.reasoning.content, type: 'summary_text' }],
          type: 'reasoning',
        } as OpenAI.Responses.ResponseReasoningItem);
      }

      // if message is assistant messages with tool calls , transform it to function type item
      if (message.role === 'assistant' && message.tool_calls && message.tool_calls?.length > 0) {
        // Preserve assistant text content BEFORE the function_call items. The
        // Responses API accepts interleaved message/function items in `input`, and
        // dropping the text breaks multi-turn continuity and prompt-cache prefixes
        // when the assistant turn had both commentary and tool calls.
        const assistantText = toResponseAssistantTextContent(message.content);
        if (assistantText.trim().length > 0) {
          items.push({
            content: assistantText,
            role: 'assistant',
          } as OpenAI.Responses.EasyInputMessage);
        }

        message.tool_calls.forEach((tool) => {
          items.push({
            arguments: tool.function.arguments,
            call_id: tool.id,
            name: tool.function.name,
            type: 'function_call',
          });
        });

        return items;
      }

      if (message.role === 'tool') {
        items.push({
          call_id: message.tool_call_id,
          output: message.content,
          type: 'function_call_output',
        } as OpenAI.Responses.ResponseFunctionToolCallOutputItem);

        return items;
      }

      if (message.role === 'system') {
        items.push({
          content: message.content,
          role: 'developer',
        } as OpenAI.Responses.EasyInputMessage);
        return items;
      }

      // Assistant replay uses string easy-input content. Strict Responses
      // gateways reject `input_text` parts for the assistant role.
      if (message.role === 'assistant') {
        items.push({
          content: toResponseAssistantTextContent(message.content),
          role: 'assistant',
        } as OpenAI.Responses.EasyInputMessage);
        return items;
      }

      // default item (user messages), also handle images
      items.push({
        content: await toResponseInputContentAsync(message.content),
        role: 'user',
      } as OpenAI.Responses.EasyInputMessage);

      return items;
    }),
  );

  return groups.flat();
};

export const pruneReasoningPayload = (payload: ChatStreamPayload) => {
  const shouldStream = !disableStreamModels.has(payload.model);
  const cleanedPayload = { ...payload } as any;
  const { stream_options } = cleanedPayload;
  delete cleanedPayload.frequency_penalty;
  delete cleanedPayload.presence_penalty;
  delete cleanedPayload.stream_options;
  delete cleanedPayload.temperature;
  delete cleanedPayload.top_p;

  return {
    ...cleanedPayload,
    messages: payload.messages.map((message: OpenAIChatMessage) => ({
      ...message,
      role:
        message.role === 'system'
          ? systemToUserModels.has(payload.model)
            ? 'user'
            : 'developer'
          : message.role,
    })),
    stream: shouldStream,
    // Only include stream_options when stream is enabled
    ...(shouldStream && stream_options && { stream_options }),
  };
};

/**
 * Convert image URL (data URL or HTTP URL) to File object for OpenAI API
 */
export const convertImageUrlToFile = async (imageUrl: string) => {
  let buffer: Buffer;
  let mimeType: string;

  if (imageUrl.startsWith('data:')) {
    // a base64 image
    const [mimeTypePart, base64Data] = imageUrl.split(',');
    mimeType = mimeTypePart.split(':')[1].split(';')[0];
    buffer = Buffer.from(base64Data, 'base64');
  } else {
    // a http url
    const response = await fetch(imageUrl);
    if (!response.ok) {
      throw new Error(`Failed to fetch image from ${imageUrl}: ${response.statusText}`);
    }
    buffer = Buffer.from(await response.arrayBuffer());
    mimeType = response.headers.get('content-type') || 'image/png';
  }

  return toFile(buffer, `image.${mimeType.split('/')[1]}`, { type: mimeType });
};
