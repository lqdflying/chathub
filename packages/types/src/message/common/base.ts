import type { ILobeAgentRuntimeErrorType } from '@lobechat/model-runtime';
import type { IPluginErrorType } from '@lobehub/chat-plugin-sdk';

import { ErrorType } from '../../fetch';

/**
 * 聊天消息错误对象
 */
export interface ChatMessageError {
  body?: any;
  message: string;
  type: ErrorType | IPluginErrorType | ILobeAgentRuntimeErrorType;
}

export interface ChatCitationItem {
  id?: string;
  onlyUrl?: boolean;
  title?: string;
  url: string;
}

export interface ModelReasoning {
  content?: string;
  duration?: number;
  /**
   * Encrypted data for `redacted_thinking` content blocks (Anthropic).
   * Each entry is a standalone opaque block with no text content; it must
   * be passed back unchanged for multi-turn continuity.
   */
  redactedSignatures?: string[];
  /**
   * Signature for the primary signed thinking block.
   * Required by Anthropic for multi-turn/tool-use thinking continuity.
   * With `display: "omitted"`, `content` is empty but `signature` carries
   * the encrypted thinking for replay.
   */
  signature?: string;
}
