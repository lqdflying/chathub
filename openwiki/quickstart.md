# OpenWiki Quickstart

ChatHub is a self-hosted AI chat platform built on top of LobeChat and significantly extended for Docker-first, PostgreSQL-backed deployments. The project focuses on multi-provider LLM access, built-in authentication, MCP/tool integration, memory and context compaction, and production-oriented server/runtime behavior.

Start here if you are new to the repo:

- [Repository overview and architecture](architecture/overview.md)
- [Runtime and provider model](architecture/model-runtime.md)
- [Context engineering and conversation shaping](architecture/context-engineering.md)
- [MCP and tool integrations](integrations/mcp-and-tools.md)
- [Authentication and environment setup](operations/auth-and-env.md)
- [Data backup and restore internals](operations/data-backup-and-restore.md)
- [Testing and change checklist](testing.md)

## What this repository is

From the root README, ChatHub is described as a production-ready AI chat platform for self-hosted deployments. It diverged from upstream LobeChat at v3.0.0 and keeps its own release and deployment story. The key product differences called out in the README are:

- Docker + PostgreSQL as the primary deployment target
- Built-in browser authentication without requiring an external OAuth service
- A broad provider/model bank, including OpenAI-compatible and Anthropic-compatible gateways
- Tools Hub features such as Picbed and API Tester
- Memory and context compaction features for long-running conversations
- MCP OAuth and tool execution support

## Repository shape

This repo is a monorepo with workspaces under `packages/*` and the main app under `src/`. The most important code areas for future changes are:

- `src/server/modules/ModelRuntime` — server-side provider bootstrapping and secret resolution
- `src/services/chat/contextEngineering.ts` — prompt/message pipeline before requests are sent to providers
- `src/services/mcp.ts` — MCP discovery, tool invocation, and reporting
- `packages/model-runtime` — provider/runtime adapters, streaming transformations, and model-specific behavior
- `packages/context-engine` — reusable pipeline processors for messages, placeholders, and tool roles
- `src/envs/llm.ts` — environment variable schema for provider configuration
- `doc/credentials-login-flow.md` — current credentials login flow details

## What to watch when editing

- Provider changes often need matching updates in both the model runtime package and the server module that resolves runtime parameters.
- Prompt/context changes can affect caching, tool role injection, image URL resolution, and provider-specific formatting.
- MCP changes often touch both frontend service code and the server-side tool/discovery APIs.
- Authentication setup is tightly coupled to environment variables; existing docs in `doc/` and the root README should stay consistent.

## Documentation map

- [Architecture overview](architecture/overview.md)
- [Model runtime details](architecture/model-runtime.md)
- [Context engineering](architecture/context-engineering.md)
- [MCP and tools](integrations/mcp-and-tools.md)
- [OpenAI-compatible cache matrix](integrations/openai-compatible-cache-matrix.md)
- [Authentication and env](operations/auth-and-env.md)
- [Testing guidance](testing.md)
