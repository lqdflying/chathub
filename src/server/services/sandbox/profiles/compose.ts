import { SANDBOX_SHARED_INSTRUCTION } from '@/tools/sandbox/systemRole';

interface ComposeInput {
  base: 'general' | 'none';
  description: string;
  /** The General instruction. Omitted when this profile uses only its own text. */
  general?: string;
  id: string;
  name: string;
  /** Mount path of each user's persistent folder; absent = none. */
  persistentFolder?: string;
  /** This profile's own extra text. */
  text?: string;
}

/**
 * Builds a profile's starting instruction from its stored fields. The same
 * fields always produce the same bytes, which keeps the system prompt
 * cache-stable (`.cursor/rules/sandbox-prompt.mdc`). A Hub read composes
 * them again, so an admin edit applies on the next call.
 *
 * Every profile uses the same rule. `base: general` starts with the General
 * instruction, then this profile's own text. `base: none` uses only its own
 * text. The default Sandbox is not a separate case.
 */
export const composeSandboxInstruction = ({
  base,
  description,
  general = SANDBOX_SHARED_INSTRUCTION,
  name,
  persistentFolder,
  text,
}: ComposeInput) => {
  const operatorText = text?.trim();
  // Depends only on the profile's settings, so the prompt stays cache-stable.
  const persistent = persistentFolder
    ? `${persistentFolder} is your persistent folder: files saved there are kept for you between sandboxes of this tool; everything else in the sandbox is lost when it is removed.
`
    : '';
  const header = `This tool is the "${name}" sandbox: ${description.trim()}
It is a separate container from any other sandbox tool in this conversation. Files move between sandboxes only through exportFile and conversation files.
${persistent}`;
  const parts = [header];
  if (base === 'general') parts.push(general);
  if (operatorText) parts.push(`Profile instructions:\n${operatorText}\n`);
  return parts.join('\n');
};
