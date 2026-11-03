import { DEFAULT_SANDBOX_INSTRUCTION } from '@/tools/sandbox/systemRole';

import { isDefaultSandboxProfile } from './schema';

interface ComposeInput {
  base: 'general' | 'none';
  description: string;
  /**
   * The General instruction other profiles build on. The `general` profile's
   * own starting text does not use this: it cannot depend on itself.
   */
  general?: string;
  id: string;
  name: string;
  /** Operator text for this profile, already read from file or inline. */
  text?: string;
}

/**
 * Builds a profile's starting instruction from its stored fields. The same
 * fields always produce the same bytes, which keeps the system prompt
 * cache-stable (`.cursor/rules/sandbox-prompt.mdc`). A Hub read composes
 * them again, so an admin edit applies on the next call.
 *
 * - `general` with no operator text is exactly the built-in Sandbox
 *   instruction, so existing agents send the same bytes as before.
 * - Other profiles start with a short fixed header so the model can tell
 *   several sandboxes apart, then the General instruction (the `general`
 *   profile's saved edit, else this built-in contract) unless `base: none`,
 *   then the operator text.
 */
export const composeSandboxInstruction = ({
  base,
  description,
  general = DEFAULT_SANDBOX_INSTRUCTION,
  id,
  name,
  text,
}: ComposeInput) => {
  const operatorText = text?.trim();

  if (isDefaultSandboxProfile({ id })) {
    if (!operatorText) return DEFAULT_SANDBOX_INSTRUCTION;
    return base === 'none' ? operatorText : `${DEFAULT_SANDBOX_INSTRUCTION}\n${operatorText}\n`;
  }

  const header = `This tool is the "${name}" sandbox: ${description.trim()}
It is a separate container from any other sandbox tool in this conversation. Files move between sandboxes only through exportFile and conversation files.
`;
  const parts = [header];
  if (base === 'general') parts.push(general);
  if (operatorText) parts.push(`Profile instructions:\n${operatorText}\n`);
  return parts.join('\n');
};
