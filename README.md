<img src="public/logo/chathub-full-banner.png" alt="ChatHub" width="600">

# ChatHub

> A self-hosted, production-ready AI chat platform — built on [LobeChat](https://github.com/lobehub/lobe-chat), significantly extended for real-world self-hosted deployments.

**Current GA is ChatHub 2.0.** ChatHub diverged from LobeChat at upstream v3.0.0 and is maintained independently. It ships as a single Docker image targeting PostgreSQL deployments, adds built-in authentication that requires no external OAuth service, ships a broader model bank, and includes tools and sidecars not present upstream.

ChatHub does not ship an Electron/desktop runtime or a browser-local database
edition. Browsers and installed PWAs use the server APIs, while durable account
data is stored in PostgreSQL. Legacy ChatHub/LobeChat JSON exports remain
importable through **Settings → Storage**.

Full user and operator guides: [GitHub Wiki](https://github.com/lqdflying/chathub/wiki).

---

## What's Different from Upstream LobeChat

| Area                      | Upstream LobeChat                     | ChatHub                                                                                                                          |
| ------------------------- | ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Deployment target         | Vercel / Docker / Desktop             | Docker + PostgreSQL only                                                                                                         |
| Versioning                | v1.x                                  | v2.x (ChatHub; unrelated to upstream)                                                                                            |
| Browser login (no OAuth)  | Not supported                         | Username/password or token login page built-in                                                                                   |
| Chat generation           | In-tab request; closing the tab cancels | Background worker in PostgreSQL; closing the tab does not cancel                                                               |
| Knowledge Base RAG        | Implicit provider defaults            | Dedicated external embeddings, pgvector HNSW, readiness banner, document-only ingestion                                          |
| Code Interpreter          | Not a first-class sidecar             | Optional DifySandbox sibling for Python that survives tab close                                                                  |
| Agent Skills              | Marketplace / different contract      | Globally installed `SKILL.md` bundles with lazy `load_skill`                                                                     |
| Artifacts gallery         | Image workspace only                  | Account-scoped gallery of generated images, including in-chat Image tool output                                                  |
| Document conversion       | In-process loaders                    | Optional MarkItDown sidecar for structured Markdown before chunking                                                              |
| Huge pastes               | Full-bleed composer and topic         | Compact **PASTED** chips in the composer and matching topic cards                                                                |
| Model bank                | Upstream releases                     | Extended: Claude 4.x, GPT-5.x, Gemini 3.x, Kimi K2.x/K3, MiniMax, DeepSeek, Zhipu GLM                                            |
| Compatible gateways       | Generic OpenAI-compat                 | OpenAI-compatible and Anthropic-compatible with documented cache / auth matrices                                                 |
| Tools Hub                 | Not present                           | Built-in (Picbed, API Tester, Password Generator + extensible sidebar)                                                           |
| Memory / context          | Basic rolling summary                 | Assistance presets, token auto-compact, manual compact, daily opt-in, assistant-level memory with cross-session rollup           |
| MCP authentication        | API keys only                         | OAuth 2.1 auto-discovery (RFC 9728 + RFC 8414) with server-side token storage                                                    |
| Model gear (extendParams) | Single generic form                   | Per-provider panels (Moonshot, MiniMax, Anthropic, OpenAI, DeepSeek)                                                             |

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
      # LLM API keys:
      # OPENAI_API_KEY=...
      # ANTHROPIC_API_KEY=...
      # MOONSHOT_API_KEY=...
      # MOONSHOT_PROXY_URL=https://your-moonshot-compatible-host/v1
      # MINIMAX_API_KEY=...
      # DEEPSEEK_API_KEY=...
      # OpenAI-compatible gateway:
      # OPENAICOMPATIBLE_API_KEY=...
      # OPENAICOMPATIBLE_PROXY_URL=https://your-host/v1
      # Anthropic-compatible gateway:
      # ANTHROPICCOMPATIBLE_API_KEY=...
      # ANTHROPICCOMPATIBLE_PROXY_URL=https://your-host/ai
      # ANTHROPICCOMPATIBLE_AUTH_MODE=bearer  # or 'api-key' (default)
      # Optional: disable background conversation generation
      # FEATURE_FLAGS=-durable_conversation_generation
      # CONVERSATION_WORKER_CONCURRENCY=4
      # DISABLE_CONVERSATION_WORKER=1
      # Dedicated Knowledge Base embedding provider (all three are required):
      # RAG_EMBEDDING_PROVIDER=openai
      # RAG_EMBEDDING_MODEL=text-embedding-3-small
      # RAG_EMBEDDING_API_KEY=...
      # Privacy-safe Knowledge Base lifecycle diagnostics:
      # CHATHUB_KNOWLEDGE_DEBUG=1 # or verbose
      # Code Interpreter sidecar (must match code-interpreter API_KEY):
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
      # Required: 0.2.10+ discards HTTP preload unless this is true.
      - ENABLE_PRELOAD=true
    volumes:
      - ./data/code-interpreter/dependencies:/dependencies
    healthcheck:
      test: ['CMD', 'curl', '-f', 'http://localhost:8194/health']
      interval: 10s
      timeout: 5s
      retries: 10
      start_period: 60s
    # No host port — ChatHub reaches it on the Compose network only.
```

Database migrations run automatically on container startup. For upgrade procedures, volume management, and migration troubleshooting, see [Docker Deployment and Upgrades](https://github.com/lqdflying/chathub/wiki/Docker-Deployment-and-Upgrades). Code Interpreter Python runs in the `code-interpreter` sibling ([wiki](https://github.com/lqdflying/chathub/wiki/Code-Interpreter-Sandbox)); omit that service, the `chathub` `depends_on` entry, and the `SANDBOX_PROVIDER` / `CODE_INTERPRETER_*` variables if you do not need it.

---

## Authentication

Auth is required. Set at least one of `NEXT_PUBLIC_ENABLE_NEXT_AUTH`, `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, or `AUTH_TOKEN`.

**Credentials login** (built-in, no OAuth needed):

```env
NEXT_PUBLIC_ENABLE_NEXT_AUTH=1
NEXT_AUTH_SECRET=<your-secret>
NEXT_AUTH_SSO_PROVIDERS=credentials
AUTH_CREDENTIALS_USERNAME=admin
AUTH_CREDENTIALS_PASSWORD=your-strong-password
# Optional: AUTH_TOKEN=your-secret-token  (also works as API Bearer auth)
# Optional: AUTH_SESSION_MAX_AGE_DAYS=7   (default 30)
```

Combine credentials with OAuth providers: `NEXT_AUTH_SSO_PROVIDERS=credentials,github`.

Full details (NextAuth, OIDC, Clerk, session config, credentials login flow): [Authentication](https://github.com/lqdflying/chathub/wiki/Authentication).

---

## What's in ChatHub 2.0

One- or two-line summaries. Procedures live in the wiki.

### Chat

- **Background conversation generation** — Replies, server-capable tool turns (web browsing, Code Interpreter, Memory, HTTP MCP), group supervisor decisions, topic titles, translation, and guarded memory compaction continue after you close the tab. **Stop** and destructive history actions cancel matching work. Browser-only keys and image/non-HTTP MCP tools stay on the open tab. Requires a server-reachable provider API key (`FEATURE_FLAGS=-durable_conversation_generation` to disable). [Details](https://github.com/lqdflying/chathub/wiki/Background-Conversation-Generation)
- **Pasted text cards** — Large dumps collapse to a compact **PASTED** chip in the composer and a matching card in the topic. The model still receives the full text. [Details](https://github.com/lqdflying/chathub/wiki/Pasted-Text)
- **Context Export** — Capture the context prepared for the next model request (instructions, messages, tools, token allocation). [Details](https://github.com/lqdflying/chathub/wiki/Context-Export)
- **Memory and context compaction** — Topic-level auto/manual compaction, daily notes, archives, and assistant-level cross-session memory with periodic LLM rollup. [Details](https://github.com/lqdflying/chathub/wiki/Memory-and-Context-Compaction)
- **Chat Instruction** — Standing user instruction applied across chats for that account.

### Knowledge

- **Knowledge Base vector RAG** — Dedicated OpenAI, Cohere, or Voyage embeddings (chat API keys are never an implicit fallback), pgvector HNSW search, document-only ingestion, and an explicit readiness banner. [Details](https://github.com/lqdflying/chathub/wiki/Knowledge-Base-and-RAG)
- **MarkItDown sidecar** — Optional companion that converts uploads to structured Markdown before chunking. [Details](https://github.com/lqdflying/chathub/wiki/MarkItDown-Sidecar)

### Tools

- **Tools Hub** — Desktop Tools sidebar / mobile More → Tools: Picbed (S3 image and video hosting), API Tester, Password Generator. [Details](https://github.com/lqdflying/chathub/wiki/Tools-Hub)
- **Code Interpreter sandbox** — Python the assistant writes runs on a `langgenius/dify-sandbox:0.2.15` sibling, not in the ChatHub image. [Details](https://github.com/lqdflying/chathub/wiki/Code-Interpreter-Sandbox)
- **MCP OAuth 2.1** — Paste a Streamable HTTP MCP URL; auto-discovery, popup authorize, server-side tokens. [Details](https://github.com/lqdflying/chathub/wiki/MCP-OAuth)
- **MCP library** — Settings page for installed HTTP MCP plugins (list + detail). [Details](https://github.com/lqdflying/chathub/wiki/MCP-Management)
- **Agent Skills** — Globally installed `SKILL.md` bundles; lazy `load_skill` in chat. [Details](https://github.com/lqdflying/chathub/wiki/Skills)

### Media

- **Image generation** — DALL-E, GPT-Image, Gemini Image, and in-chat Image tool. [Details](https://github.com/lqdflying/chathub/wiki/Image-Generation)
- **Artifacts gallery** — Account-scoped gallery of generated images at `/artifacts`. [Details](https://github.com/lqdflying/chathub/wiki/Artifacts)
- **Inline SVG diagrams** — Themed SVG artifacts plus rendered HTML / SVG / Mermaid code blocks. [Details](https://github.com/lqdflying/chathub/wiki/Inline-SVG-Diagrams)

### Providers

- **Extended model bank** — Latest Claude, GPT-5.x, Gemini 3.x, Kimi K2.x/K3, MiniMax, DeepSeek, Zhipu GLM, plus OpenAI-compatible and Anthropic-compatible gateways. [Details](https://github.com/lqdflying/chathub/wiki/Model-Providers)
- **Model extension options** — Per-provider gear popovers from the model bank; MiniMax context trimming before API calls. [Details](https://github.com/lqdflying/chathub/wiki/Model-Extension-Options)
- **OpenAI-compatible prompt cache** — Provider-settings matrix (not a model gear option). [Details](https://github.com/lqdflying/chathub/wiki/OpenAI-Compatible-Cache-Matrix)
- **Moonshot Kimi K3** — Catalogue model with a 1M-token window and forced `reasoning_effort: "max"`; it does not replace the global initial model (`gpt-5-mini`). Built-in Moonshot route is `https://api.moonshot.cn/v1`; use `MOONSHOT_PROXY_URL` for `api.moonshot.ai`. [Model Providers](https://github.com/lqdflying/chathub/wiki/Model-Providers)

### Ops

- **Built-in credentials login** — Username/password or token page; no external OAuth required. [Authentication](https://github.com/lqdflying/chathub/wiki/Authentication)
- **JSON backup and restore** — Versioned account export/import under Settings → Storage (files and object storage excluded). [Details](https://github.com/lqdflying/chathub/wiki/Data-Backup-and-Restore)
- **PWA** — Installable app; icons use separate `any` (transparent corners) and `maskable` (full-bleed) assets.
- **Debug switches** — Privacy-safe diagnostics for knowledge, tools, generation, compaction, and cache. [Details](https://github.com/lqdflying/chathub/wiki/Debug-and-Diagnostics)

---

## LLM Provider Environment Variables

| Provider             | Env                                                                                                        |
| -------------------- | ---------------------------------------------------------------------------------------------------------- |
| OpenAI (GPT)         | `OPENAI_API_KEY`                                                                                           |
| Anthropic (Claude)   | `ANTHROPIC_API_KEY`                                                                                        |
| Google (Gemini)      | `GOOGLE_API_KEY`                                                                                           |
| Moonshot (Kimi)      | `MOONSHOT_API_KEY` + optional `MOONSHOT_PROXY_URL`                                                         |
| MiniMax              | `MINIMAX_API_KEY`                                                                                          |
| DeepSeek             | `DEEPSEEK_API_KEY`                                                                                         |
| OpenAI-compatible    | `OPENAICOMPATIBLE_API_KEY` + `OPENAICOMPATIBLE_PROXY_URL`                                                  |
| Anthropic-compatible | `ANTHROPICCOMPATIBLE_API_KEY` + `ANTHROPICCOMPATIBLE_PROXY_URL` + optional `ANTHROPICCOMPATIBLE_AUTH_MODE` |
| Ollama               | auto-discovered (set `ENABLED_OLLAMA=0` to disable)                                                        |

For the complete provider/env map (Azure, Bedrock, OpenRouter, and 40+ others), see [`src/envs/llm.ts`](src/envs/llm.ts).

## Knowledge Base RAG Provider

Knowledge Base indexing and retrieval require a dedicated external embedding
provider. Chat/LLM provider credentials are never used as an implicit fallback.
Configure OpenAI, Cohere, or Voyage with `RAG_EMBEDDING_PROVIDER`,
`RAG_EMBEDDING_MODEL`, and `RAG_EMBEDDING_API_KEY`, or save an encrypted
per-account override under **Settings → RAG Provider**. PostgreSQL must include
the `pgvector` extension; the Compose example uses the pgvector image for this
reason. Retrieved context is injected only into the active initial model request.
For privacy-safe JSON lifecycle logs, set `CHATHUB_KNOWLEDGE_DEBUG=1` (or
temporarily `verbose`). See [Knowledge Base and RAG](https://github.com/lqdflying/chathub/wiki/Knowledge-Base-and-RAG).

---

## Development

```bash
pnpm install
bun run dev         # Next.js dev server on :3010
bun run type-check  # TypeScript checking
bun run lint        # ESLint + Stylelint + circular deps
bun run db:generate # Generate Drizzle migrations
bun run db:migrate  # Apply migrations locally (requires DATABASE_URL)
bun run db:studio   # Open Drizzle Studio
```

Adding a new tool or feature? See the [Architecture Overview](https://github.com/lqdflying/chathub/wiki/Architecture-Overview) wiki for repo layout and contribution guides.

---

## Docker Release

GitHub Actions builds `docker.io/lqdflying/chathub` on version tags. Current GA
is **v2.0.0** (`:latest`).

```bash
# Bump version, commit, tag, push
git tag vX.Y.Z && git push origin vX.Y.Z
```

GA tags (`v*.*.*`) update `:latest`. Canary tags (`v*.*.*-canary.*`) push pre-release images only. After 2.0.0, the next canary is `v2.0.1-canary.N`. [Full release workflow](https://github.com/lqdflying/chathub/wiki/Release-Workflow).

---

## License

Based on [LobeChat](https://github.com/lobehub/lobe-chat) — [Apache 2.0](./LICENSE).
