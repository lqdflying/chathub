import { safeParseJSON } from '@/utils/safeParseJSON';

interface McpConfig {
  headers?: Record<string, string>;
  url?: string;
}

interface McpServers {
  [key: string]: McpConfig;
}

interface ParsedMcpInput {
  mcpServers?: McpServers;
}

export enum McpParseErrorCode {
  EmptyMcpServers = 'EmptyMcpServers',
  InvalidJsonStructure = 'InvalidJsonStructure',
  InvalidMcpStructure = 'InvalidMcpStructure',
}

interface ParseSuccessResult {
  identifier: string;
  mcpConfig: McpConfig & { type: 'http'; url: string };
  status: 'success';
}

interface ParseErrorResult {
  errorCode: McpParseErrorCode;
  identifier?: string;
  status: 'error';
}

interface ParseNoOpResult {
  status: 'noop';
}

export type ParseResult = ParseSuccessResult | ParseErrorResult | ParseNoOpResult;

export const parseMcpInput = (value: string): ParseResult => {
  const parsedJson = safeParseJSON<ParsedMcpInput | McpServers>(value);

  if (parsedJson && typeof parsedJson === 'object' && !Array.isArray(parsedJson)) {
    // 1. Check for the nested "mcpServers" structure
    if (
      'mcpServers' in parsedJson &&
      typeof parsedJson.mcpServers === 'object' &&
      parsedJson.mcpServers !== null
    ) {
      const mcpKeys = Object.keys(parsedJson.mcpServers);

      if (mcpKeys.length > 0) {
        const identifier = mcpKeys[0];
        // @ts-expect-error type 不一样
        const mcpConfig = parsedJson.mcpServers[identifier];

        if (mcpConfig && typeof mcpConfig === 'object' && !Array.isArray(mcpConfig)) {
          if (!mcpConfig.url) {
            return {
              errorCode: McpParseErrorCode.InvalidMcpStructure,
              identifier,
              status: 'error',
            };
          }

          return {
            identifier,
            mcpConfig: { headers: mcpConfig.headers, type: 'http', url: mcpConfig.url },
            status: 'success',
          };
        }
        // mcpConfig is invalid or not an object
        return {
          errorCode: McpParseErrorCode.InvalidMcpStructure,
          identifier: identifier,
          status: 'error',
        };
      } else {
        // mcpServers object is empty
        return { errorCode: McpParseErrorCode.EmptyMcpServers, status: 'error' };
      }
    }
    // 3. Check for the flat structure (identifier as top-level key)
    else {
      const topLevelKeys = Object.keys(parsedJson);

      // Allow exactly one top-level key which is the identifier
      if (topLevelKeys.length === 1) {
        const identifier = topLevelKeys[0];
        // biome-ignore lint/suspicious/noExplicitAny: <explanation>
        const mcpConfig = (parsedJson as any)[identifier];

        if (mcpConfig && typeof mcpConfig === 'object' && !Array.isArray(mcpConfig)) {
          if (!mcpConfig.url) {
            // Invalid structure within the identifier's value
            return {
              errorCode: McpParseErrorCode.InvalidMcpStructure,
              identifier, // We have the identifier here
              status: 'error',
            };
          }

          // Structure parsed successfully
          return {
            identifier,
            mcpConfig: { headers: mcpConfig.headers, type: 'http', url: mcpConfig.url },
            status: 'success',
          };
        } else {
          // The value associated with the single key is not a valid config object
          return { errorCode: McpParseErrorCode.InvalidMcpStructure, identifier, status: 'error' };
        }
      } else {
        // Neither mcpServers nor manifest, and not a single top-level key structure
        return { errorCode: McpParseErrorCode.InvalidJsonStructure, status: 'error' };
      }
    }
  }

  // Input is not a valid JSON object or failed safeParseJSON
  return { status: 'noop' }; // Or potentially InvalidJsonStructure if safeParse failed but wasn't null/undefined?
};
