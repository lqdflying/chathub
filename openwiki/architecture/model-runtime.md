# Model Runtime and Provider Adapters

The model runtime package is the main abstraction layer for talking to LLM providers. It owns provider initialization, OpenAI-compatible behavior, stream transformations, error normalization, and provider-specific tests.

## What it does

`packages/model-runtime` exports the runtime used by the server module in `src/server/modules/ModelRuntime/index.ts`. That server entrypoint resolves credentials and base URLs from the user payload and environment, then calls `ModelRuntime.initializeWithProvider(...)`.

The package itself contains the core pieces for provider execution:

- `core/ModelRuntime.ts` and `core/BaseAI.ts` — runtime abstractions
- `core/openaiCompatibleFactory/` — generic OpenAI-compatible provider factory and helpers
- `core/contextBuilders/` — provider-specific message/context conversion
- `core/streams/` — stream adapters, including OpenAI Responses handling
- `utils/handleOpenAIError.ts` — provider error normalization
- `providerTestUtils.ts` — shared test scaffolding for provider behavior

## Important runtime behavior

Recent git history shows active work around OpenAI-compatible and Anthropic-compatible behavior. Notable themes:

- response cache hints and cache-key derivation for OpenAI-compatible providers
- handling response streams and non-stream-to-stream conversion
- skipping undefined SSE chunks
- stripping volatile or provider-incompatible fields from messages
- provider-specific auth modes and base URL handling
- OpenAI SDK upgrade compatibility, including stable error normalization and Responses stream typing changes

These changes matter because provider integrations are not just thin API wrappers; they must normalize request shape, stream semantics, and provider-specific edge cases.

## OpenAI-compatible path

The OpenAI-compatible factory is central to this repo's model support. Git history and the current implementation show it is used to support several compatible providers and variants, including the newer Responses API path.

The recent OpenAI SDK upgrade kept this path working by normalizing the new `Headers`-backed APIError shape and by adapting Responses-stream parsing where the SDK now types some annotation payloads as `unknown`.

Provider-specific cache hint combinations are documented in [OpenAI-compatible cache matrix](../integrations/openai-compatible-cache-matrix.md).

## Provider request debug

Moonshot, DeepSeek, and Anthropic-compatible troubleshooting can use provider-specific chat debug flags. In addition to the existing raw payload/stream logs, these flags emit a structured `[provider-debug:request]` summary with redacted base URL, full `effectiveURL`, upstream route, model, turn shape, tools summary, and payload fingerprint:

- `DEBUG_MOONSHOT_CHAT_COMPLETION=1`
- `DEBUG_DEEPSEEK_CHAT_COMPLETION=1`
- `DEBUG_ANTHROPICCOMPATIBLE_CHAT_COMPLETION=1`

Use this first for endpoint/path problems such as `url.not_found`, then inspect the raw payload only if the structured request shape is not enough. The raw debug logs can include prompt and response content.

Be careful when editing this area because it affects:

- streaming and non-streaming request behavior
- model selection for chat vs. non-chat models
- response cache hints and cache stability
- error translation and provider-specific fallbacks
- Responses API routing via `useResponse` and `useResponseModels`

## Change guidance

If you modify provider support, update the tests next to the implementation. The current repo already has provider-focused tests in:

- `packages/model-runtime/src/core/openaiCompatibleFactory/index.test.ts`
- `packages/model-runtime/src/core/streams/openai/responsesStream.test.ts`
- `packages/model-runtime/src/providers/openai/index.test.ts`
- `packages/model-runtime/src/providers/google/index.test.ts`
- `packages/model-runtime/src/providerTestUtils.test.ts`

For changes tied to the OpenAI SDK upgrade path, pay special attention to error-shape assertions and any stream fixtures that depend on Responses annotations or usage payloads.

## Key source references

- `packages/model-runtime/package.json`
- `packages/model-runtime/src/core/openaiCompatibleFactory/index.ts`
- `packages/model-runtime/src/core/streams/openai/responsesStream.ts`
- `packages/model-runtime/src/core/contextBuilders/anthropic.ts`
- `packages/model-runtime/src/utils/handleOpenAIError.ts`
- `src/server/modules/ModelRuntime/index.ts`
