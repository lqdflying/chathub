![ChatHub](public/logo/chathub-full.png)

# ChatHub

> A self-hosted, production-ready AI chat platform — built on [LobeChat](https://github.com/lobehub/lobe-chat), significantly extended for real-world self-hosted deployments.

ChatHub diverged from LobeChat at v3.0.0 and is maintained independently as ChatHub. It ships as a single Docker image targeting PostgreSQL deployments, adds built-in authentication that requires no external OAuth service, ships a broader model bank, and includes utility tools not present upstream.

---

## What's Different from Upstream LobeChat

| Area | Upstream LobeChat | ChatHub |
| ---- | ----------------- | ------- |
| Deployment target | Vercel / Docker / Desktop | Docker + PostgreSQL only |
| Versioning | v1.x | v1.x (ChatHub) |
| Browser login (no OAuth) | Not supported | Username/password or token login page built-in |
| Model bank | Upstream releases | Extended: Claude 4.x, GPT-5.x, Gemini 3.x, Kimi K2.x, MiniMax, DeepSeek |
| Tools Hub | Not present | Built-in (Picbed, API Tester + extensible sidebar) |
| Memory / context | Basic rolling summary | Assistance presets, token auto-compact, manual compact, daily opt-in, assistant-level memory with cross-session rollup |
| MCP authentication | API keys only | OAuth 2.1 auto-discovery (RFC 9728 + RFC 8414) with server-side token storage |
| Model gear (extendParams) | Single generic form | Per-provider panels (Moonshot, MiniMax, Anthropic, OpenAI, DeepSeek) |

---

## Quick Start (Docker Compose)

```yaml
services:
  chathub:
    image: docker.io/lqdflying/chathub:latest
    depends_on:
      chathub-db:
        condition: service_healthy
    environment:
      - DATABASE_URL=postgres://user:password@lobe-db:5432/postgres
      - DATABASE_DRIVER=node
      - KEY_VAULTS_SECRET=<your-secret>
      - NEXTAUTH_SECRET=<your-secret>
      - NEXTAUTH_URL=https://your-domain.com
      # LLM API keys:
      # OPENAI_API_KEY=...
      # ANTHROPIC_API_KEY=...
      # MOONSHOT_API_KEY=...
      # MINIMAX_API_KEY=...
      # DEEPSEEK_API_KEY=...
      # OpenAI-compatible gateway:
      # OPENAICOMPATIBLE_API_KEY=...
      # OPENAICOMPATIBLE_PROXY_URL=https://your-host/v1
    ports:
      - '3210:3210'

  chathub-db:
    image: postgres:16
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
```

Database migrations run automatically on container startup. For upgrade procedures, volume management, and migration troubleshooting, see the [Docker deployment wiki](https://github.com/lqdflying/chathub/wiki/Docker-Deployment-and-Upgrades).

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

Full details (NextAuth, OIDC, Clerk, session config, credentials login flow): [wiki — Authentication](https://github.com/lqdflying/chathub/wiki/Authentication).

---

## LLM Provider Environment Variables

| Provider | Env |
|----------|-----|
| OpenAI (GPT) | `OPENAI_API_KEY` |
| Anthropic (Claude) | `ANTHROPIC_API_KEY` |
| Google (Gemini) | `GOOGLE_API_KEY` |
| Moonshot (Kimi) | `MOONSHOT_API_KEY` |
| MiniMax | `MINIMAX_API_KEY` |
| DeepSeek | `DEEPSEEK_API_KEY` |
| OpenAI-compatible | `OPENAICOMPATIBLE_API_KEY` + `OPENAICOMPATIBLE_PROXY_URL` |
| Ollama | auto-discovered (set `ENABLED_OLLAMA=0` to disable) |

For the complete provider/env map (Azure, Bedrock, OpenRouter, and 40+ others), see [`src/envs/llm.ts`](src/envs/llm.ts).

---

## Key Features

- **Tools Hub** — Picbed (S3-backed image hosting), API Tester (browser-based REST client), Password Generator, extensible sidebar
- **Model extension options (gear menu)** — Per-provider compact popovers wired from the model bank; MiniMax context trimming before API calls to avoid overflow errors. [Details →](https://github.com/lqdflying/chathub/wiki/Model-Extension-Options)
- **Memory and context compaction** — Topic-level auto/manual compaction, assistant-level cross-session memory with periodic LLM rollup. [Details →](https://github.com/lqdflying/chathub/wiki/Memory-and-Context-Compaction)
- **MCP OAuth** — Auto-discovery via RFC 9728 / RFC 8414. Paste a server URL, authorize, done. Tokens stored server-side. [Details →](https://github.com/lqdflying/chathub/wiki/MCP-OAuth)

---

## Development

```bash
pnpm install
bun run dev          # Next.js dev server on :3010
bun run type-check   # TypeScript checking
bun run lint         # ESLint + Stylelint + circular deps
bun run db:generate  # Generate Drizzle migrations
bun run db:migrate   # Apply migrations locally (requires DATABASE_URL)
bun run db:studio    # Open Drizzle Studio
```

Adding a new tool or feature? See the [Architecture Overview](https://github.com/lqdflying/chathub/wiki/Architecture-Overview) wiki for repo layout and contribution guides.

---

## Docker Release

GitHub Actions builds `docker.io/lqdflying/chathub` on version tags:

```bash
# Bump version, commit, tag, push
git tag vX.Y.Z && git push origin vX.Y.Z
```

GA tags (`v*.*.*`) update `:latest`. Canary tags (`v*.*.*-canary.*`) push pre-release images only. [Full release workflow →](https://github.com/lqdflying/chathub/wiki/Release-Workflow)

---

## License

Based on [LobeChat](https://github.com/lobehub/lobe-chat) — [Apache 2.0](./LICENSE).
