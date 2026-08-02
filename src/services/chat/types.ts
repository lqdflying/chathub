import { FetchSSEOptions } from '@lobechat/fetch-sse';
import {
  ContextExportJsonValue,
  ContextExportRequestContext,
  ContextExportRequestMetadata,
  TracePayload,
} from '@lobechat/types';

export interface AgentMemoryPayload {
  dynamicMemory?: string;
  fixedMemory?: string;
}

export interface FetchOptions extends FetchSSEOptions {
  activatedSkillIds?: string[];
  agentMemory?: AgentMemoryPayload;
  contextExportRequest?: ContextExportRequestContext;
  /** Include the implicit save-memory tool for this request */
  enableMemoryTool?: boolean;
  historySummary?: string;
  isWelcomeQuestion?: boolean;
  onContextEngineered?: (snapshot: {
    engineeredInput: ContextExportJsonValue;
    metadata: ContextExportRequestMetadata;
    request: ContextExportRequestContext;
  }) => void;
  signal?: AbortSignal | undefined;
  trace?: TracePayload;
}
