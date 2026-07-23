import { describe, expect, it } from 'vitest';

import { sanitizeContextExportValue } from './contextExport';

describe('sanitizeContextExportValue', () => {
  it('removes provider identifiers, metadata, and cache-routing keys recursively', () => {
    expect(
      sanitizeContextExportValue({
        input: [
          {
            content: 'hello',
            metadata: { user_id: 'anthropic-user' },
            prompt_cache_key: 'nested-cache-key',
          },
        ],
        metadata: { user_id: 'top-level-user' },
        promptCacheKey: 'camel-cache-key',
        prompt_cache_key: 'cache-key',
        safetyIdentifier: 'camel-safety-id',
        safety_identifier: 'safety-id',
        user: 'openai-user',
        userId: 'camel-user-id',
        user_id: 'snake-user-id',
      }),
    ).toEqual({
      input: [{ content: 'hello' }],
    });
  });

  it('preserves JSON Schema property names while sanitizing their schemas', () => {
    expect(
      sanitizeContextExportValue({
        tools: [
          {
            function: {
              parameters: {
                $defs: {
                  metadata: {
                    metadata: { user_id: 'private-user' },
                    properties: {
                      provider: { type: 'string' },
                    },
                    type: 'object',
                  },
                },
                properties: {
                  metadata: { type: 'object' },
                  prompt_cache_key: { type: 'string' },
                  provider: { type: 'string' },
                  user: {
                    metadata: { user_id: 'private-user' },
                    properties: {
                      user_id: { type: 'string' },
                    },
                    type: 'object',
                  },
                },
                type: 'object',
              },
            },
            type: 'function',
          },
        ],
      }),
    ).toEqual({
      tools: [
        {
          function: {
            parameters: {
              $defs: {
                metadata: {
                  properties: {
                    provider: { type: 'string' },
                  },
                  type: 'object',
                },
              },
              properties: {
                metadata: { type: 'object' },
                prompt_cache_key: { type: 'string' },
                provider: { type: 'string' },
                user: {
                  properties: {
                    user_id: { type: 'string' },
                  },
                  type: 'object',
                },
              },
              type: 'object',
            },
          },
          type: 'function',
        },
      ],
    });
  });

  it('redacts provider-native inline media without removing ordinary data fields', () => {
    expect(
      sanitizeContextExportValue({
        anthropicImage: {
          source: {
            data: 'private-anthropic-base64',
            media_type: 'image/jpeg',
            type: 'base64',
          },
          type: 'image',
        },
        googleImage: {
          inlineData: {
            data: 'private-google-base64',
            mimeType: 'image/png',
          },
        },
        googleSnakeCaseImage: {
          inline_data: {
            data: 'private-google-snake-case-base64',
            mime_type: 'image/webp',
          },
        },
        inputAudio: {
          data: 'private-audio-base64',
          format: 'wav',
        },
        messageId: 'message-1',
        tool_call_id: 'tool-call-1',
        toolArguments: {
          data: 'ordinary tool data',
          nested: { data: 'ordinary nested tool data' },
        },
      }),
    ).toEqual({
      anthropicImage: {
        source: {
          data: '[redacted inline media data]',
          media_type: 'image/jpeg',
          type: 'base64',
        },
        type: 'image',
      },
      googleImage: {
        inlineData: {
          data: '[redacted inline media data]',
          mimeType: 'image/png',
        },
      },
      googleSnakeCaseImage: {
        inline_data: {
          data: '[redacted inline media data]',
          mime_type: 'image/webp',
        },
      },
      inputAudio: {
        data: '[redacted inline media data]',
        format: 'wav',
      },
      messageId: 'message-1',
      tool_call_id: 'tool-call-1',
      toolArguments: {
        data: 'ordinary tool data',
        nested: { data: 'ordinary nested tool data' },
      },
    });
  });

  it('redacts data URLs case-insensitively without exposing malformed payloads', () => {
    expect(
      sanitizeContextExportValue({
        uppercase: 'DATA:image/png;BASE64,private-uppercase-data',
        withoutMediaType: 'data:,private-text-data',
        withoutSemicolon: 'data:image/png,private-image-data',
      }),
    ).toEqual({
      uppercase: '[redacted data URL: image/png]',
      withoutMediaType: '[redacted data URL]',
      withoutSemicolon: '[redacted data URL: image/png]',
    });
  });
});
