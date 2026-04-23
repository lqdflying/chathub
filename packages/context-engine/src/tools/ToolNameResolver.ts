import { ChatToolPayload, MessageToolCall } from '@lobechat/types';
import { Md5 } from 'ts-md5';

import { LobeChatPluginApi, LobeToolManifest } from './types';

// Tool naming constants
const PLUGIN_SCHEMA_SEPARATOR = '____';
const PLUGIN_SCHEMA_API_MD5_PREFIX = 'MD5HASH_';

/**
 * Internal identifier for provider-native tool names (e.g. Moonshot `$web_search`)
 * that are not encoded as `plugin____api`. {@link ToolNameResolver.generate} passes
 * `apiName` through unchanged so API round-trips match the provider protocol.
 */
export const LOBE_PROVIDER_BUILTIN_IDENTIFIER = '__provider_builtin__';

/**
 * Tool Name Resolver
 * Handles tool name generation and resolution for function calling
 */
export class ToolNameResolver {
  /**
   * Generate MD5 hash for tool name shortening
   * @private
   */
  private genHash(name: string): string {
    return Md5.hashStr(name).toString().slice(0, 12);
  }

  /**
   * Generate tool calling name
   * @param identifier - Plugin identifier
   * @param name - API name
   * @param type - Plugin type (default: 'default')
   * @returns Generated tool name (max 64 characters)
   */
  generate(identifier: string, name: string, type: string = 'default'): string {
    if (identifier === LOBE_PROVIDER_BUILTIN_IDENTIFIER) {
      return name;
    }

    const pluginType = type && type !== 'default' ? `${PLUGIN_SCHEMA_SEPARATOR}${type}` : '';

    // Step 1: Try normal format
    let apiName = identifier + PLUGIN_SCHEMA_SEPARATOR + name + pluginType;

    // OpenAI GPT function_call name can't be longer than 64 characters
    // Step 2: If >= 64, hash the name part
    if (apiName.length >= 64) {
      const nameHash = PLUGIN_SCHEMA_API_MD5_PREFIX + this.genHash(name);
      apiName = identifier + PLUGIN_SCHEMA_SEPARATOR + nameHash + pluginType;

      // Step 3: If still >= 64, also hash the identifier
      if (apiName.length >= 64) {
        const identifierHash = PLUGIN_SCHEMA_API_MD5_PREFIX + this.genHash(identifier);
        apiName = identifierHash + PLUGIN_SCHEMA_SEPARATOR + nameHash + pluginType;
      }
    }

    return apiName;
  }

  /**
   * Resolve tool calls from AI response back to original tool information
   * @param toolCalls - Tool calls from AI model response
   * @param manifests - Available tool manifests mapped by identifier
   * @returns Resolved tool payloads
   */
  resolve(
    toolCalls: MessageToolCall[],
    manifests: Record<string, LobeToolManifest>,
  ): ChatToolPayload[] {
    return toolCalls
      .map((toolCall): ChatToolPayload | null => {
        const rawName = toolCall.function?.name;
        if (
          typeof rawName === 'string' &&
          rawName.startsWith('$') &&
          !rawName.includes(PLUGIN_SCHEMA_SEPARATOR)
        ) {
          const args = toolCall.function.arguments;
          return {
            apiName: rawName,
            arguments: typeof args === 'string' && args.trim().length > 0 ? args : '{}',
            id: toolCall.id,
            identifier: LOBE_PROVIDER_BUILTIN_IDENTIFIER,
            type: 'default',
            ...((toolCall as any).thoughtSignature && {
              thoughtSignature: (toolCall as any).thoughtSignature,
            }),
          };
        }

        let [identifier, apiName, type] = toolCall.function.name.split(PLUGIN_SCHEMA_SEPARATOR);

        if (!apiName) return null;

        // Step 1: Resolve hashed identifier if needed
        if (identifier.startsWith(PLUGIN_SCHEMA_API_MD5_PREFIX)) {
          const identifierMd5 = identifier.replace(PLUGIN_SCHEMA_API_MD5_PREFIX, '');
          // Find the manifest by hashed identifier
          const foundIdentifier = Object.keys(manifests).find(
            (id) => this.genHash(id) === identifierMd5,
          );
          if (foundIdentifier) {
            identifier = foundIdentifier;
          }
        }

        let payload: ChatToolPayload = {
          apiName,
          arguments: toolCall.function.arguments,
          id: toolCall.id,
          identifier,
          ...((toolCall as any).thoughtSignature && { thoughtSignature: (toolCall as any).thoughtSignature }),
          type: (type ?? 'default') as any,
        };

        // Step 2: Resolve hashed apiName if needed
        if (apiName.startsWith(PLUGIN_SCHEMA_API_MD5_PREFIX) && manifests[identifier]) {
          const md5 = apiName.replace(PLUGIN_SCHEMA_API_MD5_PREFIX, '');
          const manifest = manifests[identifier];

          const api = manifest?.api.find(
            (api: LobeChatPluginApi) => this.genHash(api.name) === md5,
          );
          if (api) {
            payload.apiName = api.name;
          }
        }

        return payload;
      })
      .filter(Boolean) as ChatToolPayload[];
  }
}
