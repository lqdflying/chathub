export const CONNECTION_CHECK_MAX_TOKENS = 256;

export const hasConnectionCheckOutput = (value: unknown) =>
  typeof value === 'string' ? value.trim().length > 0 : !!value;

export const hasConnectionCheckResult = (
  text: unknown,
  reasoning?: { content?: string },
) => hasConnectionCheckOutput(text) || hasConnectionCheckOutput(reasoning?.content);

export const buildConnectionCheckParams = (provider: string, model: string) => {
  // Non-streaming upstream: ChatHub still wraps the reply as a short SSE for the
  // browser, but MiniMax/WebKit no longer depend on a multi-chunk chat stream.
  // Mobile Safari Connectivity Check was clearing the spinner with no pass/fail
  // even when the server finished successfully (Axiom: finishReason stop + text).
  const base = {
    messages: [{ content: 'hello', role: 'user' as const }],
    model,
    provider,
    stream: false as const,
  };
  const cappedBase = {
    ...base,
    max_tokens: CONNECTION_CHECK_MAX_TOKENS,
  };

  switch (provider) {
    case 'openaicompatible':
      return base;
    case 'moonshot':
      return {
        ...cappedBase,
        thinking: { type: 'disabled' as const },
      };
    case 'zhipu':
      // GLM-5.2/4.x reasoning models enable Deep Thinking by default; with the
      // 256-token probe budget the thinking phase exhausts tokens and surfaces
      // no final content → ConnectionCheckFailed. Disable thinking for the
      // connectivity probe (mirrors moonshot). buildZhipuPayload drops the
      // field for non-thinking ids, so this is safe for all Zhipu models.
      return {
        ...cappedBase,
        thinking: { type: 'disabled' as const },
      };
    case 'minimax':
      // MiniMax-M3 thinking is on by default when `thinking` is omitted.
      // `reasoning_split` only changes output format (content <think> tags vs
      // reasoning_content) — it does NOT disable thinking. The old probe set
      // reasoning_split:false, which forced a different stream shape than
      // normal chat (default reasoning_split:true). That check path spun
      // forever on Safari iOS while desktop and normal mobile chat succeeded.
      // Disable thinking for the probe (same pattern as moonshot/zhipu/mimo);
      // leave reasoning_split unset so the adapter keeps the chat default.
      // Official: https://platform.minimax.io/docs/api-reference/text-chat-openai
      // M2.x cannot disable thinking; disabled is accepted but thinking stays on.
      return {
        ...cappedBase,
        thinking: { type: 'disabled' as const },
      };
    case 'mimo':
      // MiMo Chat Completions defaults thinking to enabled; the 256-token
      // probe would be consumed by thinking and surface no final content.
      return {
        ...cappedBase,
        thinking: { type: 'disabled' as const },
      };
    default:
      return cappedBase;
  }
};
