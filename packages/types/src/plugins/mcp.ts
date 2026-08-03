import { PluginQueryParams } from '@lobehub/market-sdk';
import { z } from 'zod';

import { MCPErrorType } from '@/libs/mcp';

import { CustomPluginMetadata } from '../tool/plugin';

/* eslint-disable typescript-sort-keys/string-enum */
export enum MCPInstallStep {
  FETCHING_MANIFEST = 'FETCHING_MANIFEST',
  GETTING_SERVER_MANIFEST = 'GETTING_SERVER_MANIFEST',
  CONFIGURATION_REQUIRED = 'CONFIGURATION_REQUIRED',
  INSTALLING_PLUGIN = 'INSTALLING_PLUGIN',
  COMPLETED = 'COMPLETED',
  ERROR = 'Error',
}

/* eslint-enable */
export type MCPPluginListParams = Pick<PluginQueryParams, 'locale' | 'pageSize' | 'page' | 'q'>;

export interface MCPErrorInfoMetadata {
  /**
   * 原始错误信息
   */
  originalError?: string;

  /**
   * MCP 连接参数
   */
  params?: {
    type?: string;
  };
  /**
   * 错误发生的步骤
   */
  step?: string;

  /**
   * 时间戳
   */
  timestamp?: number;
}
/**
 * 结构化的错误信息
 */
export interface MCPErrorInfo {
  /**
   * 核心错误信息（用户友好的简短描述）
   */
  message: string;

  /**
   * 结构化的错误元数据
   */
  metadata?: MCPErrorInfoMetadata;

  /**
   * 错误类型
   */
  type: MCPErrorType;
}

export interface MCPInstallProgress {
  configSchema?: any;
  connection?: McpConnection;
  // 结构化的错误信息，当安装失败时显示
  errorInfo?: MCPErrorInfo;
  manifest?: any;
  // LobeChatPluginManifest
  needsConfig?: boolean;
  // 0-100
  progress: number;
  step: MCPInstallStep;
}

export interface McpConnection {
  auth?: {
    accessToken?: string;
    // OAuth 2.1 fields
    authorizationEndpoint?: string;
    clientId?: string;
    clientSecret?: string;
    refreshToken?: string;
    scope?: string;
    token?: string;
    tokenEndpoint?: string;
    type: 'none' | 'bearer' | 'oauth2';
  };
  headers?: Record<string, string>;
  type: 'http';
  url: string;
}

// 测试连接参数类型
export interface McpConnectionParams {
  connection: McpConnection;
  identifier: string;
  metadata?: CustomPluginMetadata;
}

export type MCPInstallProgressMap = Record<string, MCPInstallProgress | undefined>;

// ============ Zod Schemas ============

/**
 * Zod schema for HTTP MCP authentication
 */
export const StreamableHTTPAuthSchema = z
  .object({
    accessToken: z.string().optional(), // OAuth2 Access Token
    authorizationEndpoint: z.string().optional(), // OAuth2 Authorization Endpoint
    clientId: z.string().optional(), // OAuth2 Client ID
    clientSecret: z.string().optional(), // OAuth2 Client Secret
    refreshToken: z.string().optional(), // OAuth2 Refresh Token
    scope: z.string().optional(), // OAuth2 Scope
    token: z.string().optional(), // Bearer Token
    tokenEndpoint: z.string().optional(), // OAuth2 Token Endpoint
    type: z.enum(['none', 'bearer', 'oauth2']),
  })
  .optional();

/**
 * Zod schema for getStreamableMcpServerManifest input
 */
export const GetStreamableMcpServerManifestInputSchema = z.object({
  auth: StreamableHTTPAuthSchema,
  headers: z.record(z.string()).optional(),
  identifier: z.string(),
  metadata: z
    .object({
      avatar: z.string().optional(),
      description: z.string().optional(),
    })
    .optional(),
  url: z.string().url(),
});
