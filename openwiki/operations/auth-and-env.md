# Authentication and Environment Setup

ChatHub's runtime configuration is driven heavily by environment variables. Authentication is not optional: the README states that at least one of `NEXT_PUBLIC_ENABLE_NEXT_AUTH`, `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, or `AUTH_TOKEN` must be set.

## Authentication model

The top-level README documents the built-in credentials login flow, including:

- username/password login
- access-token login
- optional combination with OAuth providers
- JWT-based session handling
- automatic user bootstrap on the first authenticated request

The current repo also contains a dedicated background document at `doc/credentials-login-flow.md` that describes how credentials login behaves in practice.

## LLM environment configuration

The main provider environment map lives in `src/envs/llm.ts`, which is referenced from the README as the canonical provider/env source. That config drives how server runtime code resolves keys and base URLs for providers like OpenAI, Anthropic, Azure, and provider-compatible gateways.

A notable recent change in `src/server/modules/ModelRuntime/index.ts` is special handling for Anthropic-compatible auth mode and proxy URL resolution. This makes provider configuration a live compatibility surface rather than a static list of keys.

## Deployment notes

The README presents Docker + PostgreSQL as the primary deployment target. Migrations run automatically in the container startup flow, and the README points readers to the Docker deployment wiki for upgrade procedures and troubleshooting.

## Change guidance

If you add or rename environment variables, update all of these places together:

- `src/envs/llm.ts`
- `README.md`
- relevant docs under `doc/`
- runtime resolution in `src/server/modules/ModelRuntime/index.ts`
- any settings UI that exposes the option

## Key source references

- `README.md`
- `doc/credentials-login-flow.md`
- `src/envs/llm.ts`
- `src/server/modules/ModelRuntime/index.ts`
