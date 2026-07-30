import { chainSummaryHistory } from '@lobechat/prompts';
import type { UIChatMessage } from '@lobechat/types';

interface PromptVars {
  messages: UIChatMessage[];
  previousSummary?: string;
}

export default function generatePrompt({ vars }: { vars: PromptVars }) {
  return chainSummaryHistory(vars.messages, vars.previousSummary).messages || [];
}
