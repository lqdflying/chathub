export const historySummaryPrompt = (historySummary: string) => `<chat_history_summary>
<docstring>Users may have lots of chat messages, here is the summary of the history:</docstring>
<summary>${historySummary}</summary>
</chat_history_summary>
`;

/**
 * Wrap the two assistant-memory tiers for system-message injection.
 * Fixed memory is user-curated and always applicable; dynamic memory is
 * auto-summarized from earlier conversations and may lag recent changes.
 */
export const agentMemoryPrompt = ({
  dynamicMemory,
  fixedMemory,
}: {
  dynamicMemory?: string;
  fixedMemory?: string;
}): string => {
  const fixed = (fixedMemory ?? '').trim();
  const dynamic = (dynamicMemory ?? '').trim();
  if (!fixed && !dynamic) return '';

  const sections = [
    fixed &&
      `<fixed_memory>
<docstring>User-curated notes and standing instructions for this assistant. Always applicable.</docstring>
${fixed}
</fixed_memory>`,
    dynamic &&
      `<dynamic_memory>
<docstring>Auto-summarized notes from earlier conversations with this assistant. May lag recent changes.</docstring>
${dynamic}
</dynamic_memory>`,
  ].filter(Boolean);

  return `<assistant_memory>
<docstring>Persistent memory for this assistant across all chats with this user. Treat it as background knowledge; the current conversation takes precedence.</docstring>
${sections.join('\n')}
</assistant_memory>`;
};

/**
 * Lobe Chat will inject some system instructions here
 */
export const BuiltinSystemRolePrompts = ({
  welcome,
  plugins,
  historySummary,
}: {
  historySummary?: string;
  plugins?: string;
  welcome?: string;
}) => {
  return [welcome, plugins, historySummary ? historySummaryPrompt(historySummary) : '']
    .filter(Boolean)
    .join('\n\n');
};
