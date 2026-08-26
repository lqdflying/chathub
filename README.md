<img src="public/logo/chathub-full-banner.png" alt="ChatHub" width="600">

# ChatHub

> Self-hosted AI chat for Docker and PostgreSQL — a fork of [LobeChat](https://github.com/lobehub/lobe-chat) that grew into its own product.

**ChatHub 2.0** is the current GA. v1.0.0 (May 2026) was a rebranded, self-hosted LobeChat: credentials login, an extended model bank, Tools Hub, MCP OAuth, and per-provider gear. Twenty-eight patch releases later, the runtime contract is different. Closing the tab does not cancel the turn. Knowledge Base is a real RAG stack with its own embedding keys. Python and document conversion are optional sidecars. There is no Electron app and no browser-local database — browsers and PWAs talk to the server; durable data lives in PostgreSQL.

Upgrade from any 1.x image the same way as a patch: pull `:latest` or `2.0.0`, restart, let migrations run. [Release notes](https://github.com/lqdflying/chathub/releases/tag/v2.0.0) · [Wiki](https://github.com/lqdflying/chathub/wiki)

---

## What 2.0 actually changed

These are the differences that matter if you used 1.0 or are choosing ChatHub over upstream.

**Leave is not Stop.** After Send, Graphile jobs in PostgreSQL keep the turn going — tools, Knowledge Base retrieve, then the model. Switching topic, mobile Back, or hiding the tab does not cancel. Stop, retry, rewind, clear, account switch, and topic delete do. Browser-only tools (in-chat Image, Kagi, non-HTTP MCP) still need that tab. You need a server-reachable provider API key for true background work. [Background Conversation Generation](https://github.com/lqdflying/chathub/wiki/Background-Conversation-Generation)

**Knowledge Base is no longer “whatever the chat key can embed.”** Indexing uses a dedicated OpenAI, Cohere, or Voyage provider (`RAG_EMBEDDING_*` or Settings → RAG Provider). Chat keys are never an implicit fallback. PostgreSQL must ship `pgvector` (the Compose example uses the pgvector image). An optional MarkItDown sidecar turns PDF/Office/HTML into structured Markdown before chunking. [Knowledge Base and RAG](https://github.com/lqdflying/chathub/wiki/Knowledge-Base-and-RAG) · [MarkItDown](https://github.com/lqdflying/chathub/wiki/MarkItDown-Sidecar)

**Python runs in a jail beside ChatHub, not in the image.** Code Interpreter talks to `langgenius/dify-sandbox:0.2.15`. The ChatHub image stays distroless; Graphile can run guest Python after you close the tab. Omit the sidecar if you do not need it. [Code Interpreter Sandbox](https://github.com/lqdflying/chathub/wiki/Code-Interpreter-Sandbox)

**Images and documents outlived the chat bubble.** In-chat Image generation is a server task (slow 4K renders survive proxies). Finished pictures live in an Artifacts gallery, matched back to the prompt that created them. SVG, full HTML pages, and Mermaid in replies render inline. [Image Generation](https://github.com/lqdflying/chathub/wiki/Image-Generation) · [Artifacts](https://github.com/lqdflying/chathub/wiki/Artifacts) · [Inline diagrams](https://github.com/lqdflying/chathub/wiki/Inline-SVG-Diagrams)

**Long context is operated, not hoped for.** Topic compaction waits for a high watermark. Assistants have two-tier memory (fixed cards you curate, dynamic rollups the model maintains). Compatible gateways (OpenAI- and Anthropic-style) are first-class, with a prompt-cache matrix so multi-turn hits stay stable. Skills are `SKILL.md` bundles with lazy `load_skill`. Huge pastes become compact **PASTED** chips instead of a wall of text. [Memory and compaction](https://github.com/lqdflying/chathub/wiki/Memory-and-Context-Compaction) · [Cache matrix](https://github.com/lqdflying/chathub/wiki/OpenAI-Compatible-Cache-Matrix) · [Skills](https://github.com/lqdflying/chathub/wiki/Skills) · [Pasted text](https://github.com/lqdflying/chathub/wiki/Pasted-Text)

What 1.0 already was, and 2.0 still is: Docker + PostgreSQL only, built-in username/password login, Tools Hub (Picbed, API Tester), MCP OAuth 2.1, and per-provider model options. Those are table stakes now, not the 2.0 story. The full map is [wiki Home](https://github.com/lqdflying/chathub/wiki).

| | Upstream LobeChat | ChatHub 2.0 |
| --- | --- | --- |
| Deploy | Vercel / Docker / Desktop | Docker + PostgreSQL only |
| Chat after you leave | Cancels with the tab | Server worker continues |
| Knowledge embeddings | Implicit chat-provider defaults | Dedicated RAG provider |
| Code Interpreter | Not a first-class sidecar | Optional DifySandbox sibling |
| Client | Includes desktop / local DB editions | Browser and PWA against the server |

---

## Quick Start (Docker Compose)

```yaml
services:
  chathub:
    image: docker.io/lqdflying/chathub:latest
    depends_on:
      chathub-db:
        condition: service_healthy
      code-interpreter:
        condition: service_healthy
    environment:
      - DATABASE_URL=postgres://user:password@chathub-db:5432/postgres
      - DATABASE_DRIVER=node
      - KEY_VAULTS_SECRET=<your-secret>
      - NEXTAUTH_SECRET=<your-secret>
      - NEXTAUTH_URL=https://your-domain.com
      # LLM API keys — see Model Providers in the wiki
      # OPENAI_API_KEY=...
      # ANTHROPIC_API_KEY=...
      # OPENAICOMPATIBLE_API_KEY=...
      # OPENAICOMPATIBLE_PROXY_URL=https://your-host/v1
      # Dedicated Knowledge Base embeddings (all three required to index):
      # RAG_EMBEDDING_PROVIDER=openai
      # RAG_EMBEDDING_MODEL=text-embedding-3-small
      # RAG_EMBEDDING_API_KEY=...
      # Optional: FEATURE_FLAGS=-durable_conversation_generation
      - SANDBOX_PROVIDER=dify
      - CODE_INTERPRETER_SANDBOX_URL=http://code-interpreter:8194
      - CODE_INTERPRETER_SANDBOX_API_KEY=<your-sandbox-api-key>
    ports:
      - '3210:3210'

  chathub-db:
    image: pgvector/pgvector:pg16
    environment:
      POSTGRES_USER: user
      POSTGRES_PASSWORD: password
      POSTGRES_DB: postgres
    volumes:
      - ./data/postgres:/var/lib/postgresql/data
    healthcheck:
      test: ['CMD-SHELL', 'pg_isready -U user -d postgres']
      interval: 5s
      timeout: 5s
      retries: 5

  code-interpreter:
    image: langgenius/dify-sandbox:0.2.15
    restart: always
    environment:
      - API_KEY=<your-sandbox-api-key>
      - GIN_MODE=release
      - WORKER_TIMEOUT=60
      - ENABLE_NETWORK=true
      - ENABLE_PRELOAD=true
    volumes:
      - ./data/code-interpreter/dependencies:/dependencies
    healthcheck:
      test: ['CMD', 'curl', '-f', 'http://localhost:8194/health']
      interval: 10s
      timeout: 5s
      retries: 10
      start_period: 60s
```

Omit `code-interpreter`, its `depends_on` entry, and the `SANDBOX_PROVIDER` / `CODE_INTERPRETER_*` variables if you do not need Python. Migrations run on startup. Upgrades, volumes, and 1Panel env files: [Docker Deployment and Upgrades](https://github.com/lqdflying/chathub/wiki/Docker-Deployment-and-Upgrades).

---

## Authentication

Auth is required. Set at least one of `NEXT_PUBLIC_ENABLE_NEXT_AUTH`, `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, or `AUTH_TOKEN`.

```env
NEXT_PUBLIC_ENABLE_NEXT_AUTH=1
NEXT_AUTH_SECRET=<your-secret>
NEXT_AUTH_SSO_PROVIDERS=credentials
AUTH_CREDENTIALS_USERNAME=admin
AUTH_CREDENTIALS_PASSWORD=your-strong-password
# Optional: AUTH_TOKEN=...          (also API Bearer)
# Optional: AUTH_SESSION_MAX_AGE_DAYS=7   (default 30)
```

Combine with OAuth: `NEXT_AUTH_SSO_PROVIDERS=credentials,github`. Details: [Authentication](https://github.com/lqdflying/chathub/wiki/Authentication).

---

## LLM provider environment variables

| Provider | Env |
| --- | --- |
| OpenAI (GPT) | `OPENAI_API_KEY` |
| Anthropic (Claude) | `ANTHROPIC_API_KEY` |
| Google (Gemini) | `GOOGLE_API_KEY` |
| Moonshot (Kimi) | `MOONSHOT_API_KEY` + optional `MOONSHOT_PROXY_URL` |
| MiniMax | `MINIMAX_API_KEY` |
| DeepSeek | `DEEPSEEK_API_KEY` |
| OpenAI-compatible | `OPENAICOMPATIBLE_API_KEY` + `OPENAICOMPATIBLE_PROXY_URL` |
| Anthropic-compatible | `ANTHROPICCOMPATIBLE_API_KEY` + `ANTHROPICCOMPATIBLE_PROXY_URL` + optional `ANTHROPICCOMPATIBLE_AUTH_MODE` |
| Ollama | auto-discovered (`ENABLED_OLLAMA=0` to disable) |

Complete map (Azure, Bedrock, OpenRouter, Zhipu, and 40+ others): [`src/envs/llm.ts`](src/envs/llm.ts) · [Model Providers](https://github.com/lqdflying/chathub/wiki/Model-Providers)

Account JSON backup (not object storage) is **Settings → Storage**. [Backup and Restore](https://github.com/lqdflying/chathub/wiki/Data-Backup-and-Restore)

---

## Development

```bash
pnpm install
bun run dev         # Next.js dev server on :3010
bun run type-check
bun run lint
bun run db:generate
bun run db:migrate  # requires DATABASE_URL
bun run db:studio
```

Repo layout: [Architecture Overview](https://github.com/lqdflying/chathub/wiki/Architecture-Overview).

---

## Docker Release

GitHub Actions builds `docker.io/lqdflying/chathub` on version tags. GA `v*.*.*` updates `:latest`. Canaries (`v*.*.*-canary.*`) do not. Current GA is **v2.0.0**; the next canary is `v2.0.1-canary.N`. [Release Workflow](https://github.com/lqdflying/chathub/wiki/Release-Workflow)

---

## License

Based on [LobeChat](https://github.com/lobehub/lobe-chat) — [Apache 2.0](./LICENSE).
