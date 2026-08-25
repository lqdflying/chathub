import {
  parseCompactionDebugLevel,
  parseImageDebugLevel,
  parseKnowledgeDebugLevel,
  parseToolsDebugLevel,
} from '@/libs/logger/bootstrap';

/**
 * Server-side debug configuration.
 * Not prefixed with NEXT_PUBLIC — not exposed to the browser bundle.
 */
export const getServerDebugConfig = () => ({
  CHATHUB_COMPACTION_DEBUG: process.env.CHATHUB_COMPACTION_DEBUG || '',
  CHATHUB_COMPACTION_DEBUG_LEVEL: parseCompactionDebugLevel(process.env.CHATHUB_COMPACTION_DEBUG),
  CHATHUB_DEBUG: process.env.CHATHUB_DEBUG === '1',
  CHATHUB_IMAGE_DEBUG: process.env.CHATHUB_IMAGE_DEBUG || '',
  CHATHUB_IMAGE_DEBUG_LEVEL: parseImageDebugLevel(process.env.CHATHUB_IMAGE_DEBUG),
  CHATHUB_KNOWLEDGE_DEBUG: process.env.CHATHUB_KNOWLEDGE_DEBUG || '',
  CHATHUB_KNOWLEDGE_DEBUG_LEVEL: parseKnowledgeDebugLevel(process.env.CHATHUB_KNOWLEDGE_DEBUG),
  CHATHUB_TOOLS_DEBUG: process.env.CHATHUB_TOOLS_DEBUG || '',
  CHATHUB_TOOLS_DEBUG_LEVEL: parseToolsDebugLevel(process.env.CHATHUB_TOOLS_DEBUG),
  DEBUG: process.env.DEBUG || '',
  LOG_LEVEL: process.env.LOG_LEVEL,
});
