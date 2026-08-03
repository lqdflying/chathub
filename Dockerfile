## Set global build ENV
ARG NODEJS_VERSION="24"

# Optional Next.js webpack cache — empty by default.
# Override in CI with: --build-context nextjs_cache=<path-to-restored-cache>
# This allows webpack to only recompile changed modules (warm build: ~3 min vs cold: ~7.3 min).
FROM scratch AS nextjs_cache

## Base image for all building stages
FROM node:${NODEJS_VERSION}-slim AS base

ARG USE_CN_MIRROR

ENV DEBIAN_FRONTEND="noninteractive"

RUN \
    # If you want to build docker in China, build with --build-arg USE_CN_MIRROR=true
    if [ "${USE_CN_MIRROR:-false}" = "true" ]; then \
        sed -i "s/deb.debian.org/mirrors.ustc.edu.cn/g" "/etc/apt/sources.list.d/debian.sources"; \
    fi \
    # Add required package
    && apt update \
    && apt install ca-certificates proxychains-ng -qy \
    # Prepare required package to distroless
    && mkdir -p /distroless/bin /distroless/etc /distroless/etc/ssl/certs /distroless/lib \
    # Copy proxychains to distroless
    && cp /usr/lib/$(arch)-linux-gnu/libproxychains.so.4 /distroless/lib/libproxychains.so.4 \
    && cp /usr/lib/$(arch)-linux-gnu/libdl.so.2 /distroless/lib/libdl.so.2 \
    && cp /usr/lib/$(arch)-linux-gnu/librt.so.1 /distroless/lib/librt.so.1 \
    && cp /usr/bin/proxychains4 /distroless/bin/proxychains \
    && cp /etc/proxychains4.conf /distroless/etc/proxychains4.conf \
    # Copy node to distroless
    && cp /usr/lib/$(arch)-linux-gnu/libstdc++.so.6 /distroless/lib/libstdc++.so.6 \
    && cp /usr/lib/$(arch)-linux-gnu/libgcc_s.so.1 /distroless/lib/libgcc_s.so.1 \
    && cp /usr/local/bin/node /distroless/bin/node \
    # Copy CA certificates to distroless
    && cp /etc/ssl/certs/ca-certificates.crt /distroless/etc/ssl/certs/ca-certificates.crt \
    # Cleanup temp files
    && rm -rf /tmp/* /var/lib/apt/lists/* /var/tmp/*

## Builder image, install all the dependencies and build the app
FROM base AS builder

ARG USE_CN_MIRROR
ARG NEXT_PUBLIC_BASE_PATH
ARG NEXT_PUBLIC_ENABLE_NEXT_AUTH
ARG NEXT_PUBLIC_ENABLE_CLERK_AUTH
ARG NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY
ARG NEXT_PUBLIC_SENTRY_DSN
ARG NEXT_PUBLIC_ANALYTICS_POSTHOG
ARG NEXT_PUBLIC_POSTHOG_HOST
ARG NEXT_PUBLIC_POSTHOG_KEY
ARG NEXT_PUBLIC_ANALYTICS_UMAMI
ARG NEXT_PUBLIC_UMAMI_SCRIPT_URL
ARG NEXT_PUBLIC_UMAMI_WEBSITE_ID
ARG FEATURE_FLAGS
# Git ref at build time (e.g. v3.4.38-canary.1) so About / diagnostics match the image tag
ARG NEXT_PUBLIC_APP_TAG

ENV NEXT_PUBLIC_BASE_PATH="${NEXT_PUBLIC_BASE_PATH}" \
    FEATURE_FLAGS="${FEATURE_FLAGS}"

ENV NEXT_PUBLIC_APP_TAG="${NEXT_PUBLIC_APP_TAG}" \
    NEXT_PUBLIC_ENABLE_NEXT_AUTH="${NEXT_PUBLIC_ENABLE_NEXT_AUTH:-1}" \
    NEXT_PUBLIC_ENABLE_CLERK_AUTH="${NEXT_PUBLIC_ENABLE_CLERK_AUTH:-0}" \
    NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY="${NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY}" \
    CLERK_WEBHOOK_SECRET="whsec_xxx" \
    APP_URL="http://app.com" \
    DATABASE_DRIVER="node" \
    DATABASE_URL="postgres://postgres:password@localhost:5432/postgres" \
    KEY_VAULTS_SECRET="use-for-build"

# Sentry
ENV NEXT_PUBLIC_SENTRY_DSN="${NEXT_PUBLIC_SENTRY_DSN}" \
    SENTRY_ORG="" \
    SENTRY_PROJECT=""

# Posthog
ENV NEXT_PUBLIC_ANALYTICS_POSTHOG="${NEXT_PUBLIC_ANALYTICS_POSTHOG}" \
    NEXT_PUBLIC_POSTHOG_HOST="${NEXT_PUBLIC_POSTHOG_HOST}" \
    NEXT_PUBLIC_POSTHOG_KEY="${NEXT_PUBLIC_POSTHOG_KEY}"

# Umami
ENV NEXT_PUBLIC_ANALYTICS_UMAMI="${NEXT_PUBLIC_ANALYTICS_UMAMI}" \
    NEXT_PUBLIC_UMAMI_SCRIPT_URL="${NEXT_PUBLIC_UMAMI_SCRIPT_URL}" \
    NEXT_PUBLIC_UMAMI_WEBSITE_ID="${NEXT_PUBLIC_UMAMI_WEBSITE_ID}"

# Node
ENV NODE_OPTIONS="--max-old-space-size=4096"

WORKDIR /app

# Install native addon build tools required by packages such as re2
# Kept in a dedicated layer — only re-runs if the tool list changes
RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*

# ── Layer 1: toolchain ────────────────────────────────────────────────────────
# Copy only the files needed to install + enable the correct pnpm version.
# This layer is invalidated only when packageManager field or .npmrc changes.
COPY package.json pnpm-workspace.yaml .npmrc ./
RUN \
    if [ "${USE_CN_MIRROR:-false}" = "true" ]; then \
        npm config set registry "https://registry.npmmirror.com/"; \
    fi \
    && export COREPACK_NPM_REGISTRY=$(npm config get registry | sed 's/\/$//') \
    && npm i -g corepack@latest \
    && corepack enable \
    && PNPM_VERSION=$(node -p "require('./package.json').packageManager.split('@')[1]") \
    && corepack prepare pnpm@${PNPM_VERSION} --activate

# ── Layer 2: dependency install ───────────────────────────────────────────────
# Copy only package.json from each workspace package.
# Source-code changes in packages/* will NOT invalidate this layer.
COPY packages/agent-runtime/package.json      packages/agent-runtime/
COPY packages/const/package.json              packages/const/
COPY packages/context-engine/package.json     packages/context-engine/
COPY packages/database/package.json           packages/database/
COPY packages/fetch-sse/package.json          packages/fetch-sse/
COPY packages/file-loaders/package.json       packages/file-loaders/
COPY packages/memory-extract/package.json     packages/memory-extract/
COPY packages/model-bank/package.json         packages/model-bank/
COPY packages/model-runtime/package.json      packages/model-runtime/
COPY packages/obervability-otel/package.json  packages/obervability-otel/
COPY packages/prompts/package.json            packages/prompts/
COPY packages/python-interpreter/package.json packages/python-interpreter/
COPY packages/ssrf-safe-fetch/package.json    packages/ssrf-safe-fetch/
COPY packages/types/package.json              packages/types/
COPY packages/utils/package.json              packages/utils/
COPY packages/web-crawler/package.json        packages/web-crawler/

# Strip the `version` field so version bumps don't bust the install cache.
RUN \
    if [ "${USE_CN_MIRROR:-false}" = "true" ]; then \
        export SENTRYCLI_CDNURL="https://npmmirror.com/mirrors/sentry-cli"; \
        echo 'canvas_binary_host_mirror=https://npmmirror.com/mirrors/canvas' >> .npmrc; \
    fi \
    && sed -i '/"version":/d' package.json

# pnpm install with persistent store cache.
# --mount=type=cache: even on a layer-cache miss, packages aren't re-downloaded.
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm i \
    && mkdir -p /deps \
    && cd /deps \
    && pnpm init \
    && pnpm add pg drizzle-orm

# ── Layer 3: source + build ───────────────────────────────────────────────────
# Copy full source (overrides stub package.json files with real ones + src/ trees).
# Invalidated on any source change — but pnpm install above is still cached.
COPY . .

# Inject Next.js webpack cache before compilation:
#   - GHA: provided via --build-context nextjs_cache=<restored-path> (from actions/cache)
#   - Local: via --mount=type=cache (persists between local docker build invocations)
# Both are optional — build succeeds cold if both are empty.
# Build also skips ESLint/Stylelint/circular (CI gates, not build requirements) — saves ~2-3 min.
RUN --mount=type=bind,from=nextjs_cache,target=/tmp/nextjs-restore \
    --mount=type=cache,id=nextjs-build-cache,target=/tmp/nextjs-local-cache,sharing=locked \
    mkdir -p .next/cache \
    && (cp -r /tmp/nextjs-restore/. .next/cache/ 2>/dev/null || \
        cp -r /tmp/nextjs-local-cache/. .next/cache/ 2>/dev/null || \
        true) \
    && export PATH="$PATH:/app/node_modules/.bin" \
    && NODE_OPTIONS=--max-old-space-size=6144 DOCKER=true next build \
    && (cp -r .next/cache/. /tmp/nextjs-local-cache/ 2>/dev/null || true)

# Copy re2 native binary into standalone output (file tracing misses dynamic require paths)
RUN find /app/node_modules/.pnpm -name "re2.node" | while read src; do \
    dst=$(echo "$src" | sed 's|/app/node_modules/|/app/.next/standalone/node_modules/|'); \
    mkdir -p "$(dirname "$dst")"; \
    cp "$src" "$dst" && echo "Copied re2.node to $dst"; \
    done

## Application image, copy all the files for production
FROM busybox:latest AS app

COPY --from=base /distroless/ /

# Automatically leverage output traces to reduce image size
# https://nextjs.org/docs/advanced-features/output-file-tracing
COPY --from=builder /app/.next/standalone /app/

# Copy database migrations
COPY --from=builder /app/packages/database/migrations /app/migrations
COPY --from=builder /app/scripts/migrateServerDB/docker.cjs /app/docker.cjs
COPY --from=builder /app/scripts/migrateServerDB/ensureAgentAssistantMemory.cjs /app/ensureAgentAssistantMemory.cjs
COPY --from=builder /app/scripts/migrateServerDB/ensureChatGroupMembershipOwnership.cjs /app/ensureChatGroupMembershipOwnership.cjs
COPY --from=builder /app/scripts/migrateServerDB/ensureConversationVersion.cjs /app/ensureConversationVersion.cjs
COPY --from=builder /app/scripts/migrateServerDB/ensureMessageOrder.cjs /app/ensureMessageOrder.cjs
COPY --from=builder /app/scripts/migrateServerDB/ensureMcpOAuthTokens.cjs /app/ensureMcpOAuthTokens.cjs
COPY --from=builder /app/scripts/migrateServerDB/ensurePicbedImages.cjs /app/ensurePicbedImages.cjs
COPY --from=builder /app/scripts/migrateServerDB/ensureSkillsStorage.cjs /app/ensureSkillsStorage.cjs
COPY --from=builder /app/scripts/migrateServerDB/ensureTopicLastActivity.cjs /app/ensureTopicLastActivity.cjs
COPY --from=builder /app/scripts/migrateServerDB/errorHint.js /app/errorHint.js

# copy dependencies
COPY --from=builder /deps/node_modules/.pnpm /app/node_modules/.pnpm
COPY --from=builder /deps/node_modules/pg /app/node_modules/pg
COPY --from=builder /deps/node_modules/drizzle-orm /app/node_modules/drizzle-orm

# Copy server launcher
COPY --from=builder /app/scripts/serverLauncher/startServer.js /app/startServer.js

RUN \
    # Add nextjs:nodejs to run the app
    addgroup -S -g 1001 nodejs \
    && adduser -D -G nodejs -H -S -h /app -u 1001 nextjs \
    # Set permission for nextjs:nodejs
    && chown -R nextjs:nodejs /app /etc/proxychains4.conf

# Minimal stage containing only .next/cache — used by GHA to extract and persist
# the webpack cache between releases without touching the production image.
FROM scratch AS cache-export
COPY --from=builder /app/.next/cache /cache

## Production image, copy all the files and run next
FROM scratch

# Copy all the files from app, set the correct permission for prerender cache
COPY --from=app / /

ENV NODE_ENV="production" \
    NODE_OPTIONS="--dns-result-order=ipv4first --use-openssl-ca" \
    NODE_EXTRA_CA_CERTS="" \
    NODE_TLS_REJECT_UNAUTHORIZED="" \
    SSL_CERT_FILE="/etc/ssl/certs/ca-certificates.crt"

# Make the middleware rewrite through local as default
# refs: https://github.com/lobehub/lobe-chat/issues/5876
ENV MIDDLEWARE_REWRITE_THROUGH_LOCAL="1"

# set hostname to localhost
ENV HOSTNAME="0.0.0.0" \
    PORT="3210"

# General Variables
ENV ACCESS_CODE="" \
    APP_URL="" \
    API_KEY_SELECT_MODE="" \
    DEFAULT_AGENT_CONFIG="" \
    SYSTEM_AGENT="" \
    FEATURE_FLAGS="" \
    PROXY_URL="" \
    ENABLE_AUTH_PROTECTION=""

# Database
ENV KEY_VAULTS_SECRET="" \
    DATABASE_DRIVER="node" \
    DATABASE_URL=""

# Next Auth
ENV NEXT_AUTH_SECRET="" \
    NEXT_AUTH_SSO_PROVIDERS="" \
    NEXTAUTH_URL=""

# Clerk
ENV CLERK_SECRET_KEY="" \
    CLERK_WEBHOOK_SECRET=""

# S3
ENV NEXT_PUBLIC_S3_DOMAIN="" \
    S3_PUBLIC_DOMAIN="" \
    S3_ACCESS_KEY_ID="" \
    S3_BUCKET="" \
    S3_ENDPOINT="" \
    S3_SECRET_ACCESS_KEY="" \
    S3_ENABLE_PATH_STYLE="" \
    S3_SET_ACL=""

# Model Variables
ENV \
    # AI21
    AI21_API_KEY="" AI21_MODEL_LIST="" \
    # Ai360
    AI360_API_KEY="" AI360_MODEL_LIST="" \
    # AiHubMix
    AIHUBMIX_API_KEY="" AIHUBMIX_MODEL_LIST="" \
    # Anthropic
    ANTHROPIC_API_KEY="" ANTHROPIC_MODEL_LIST="" ANTHROPIC_PROXY_URL="" \
    # Amazon Bedrock
    ENABLED_AWS_BEDROCK="" AWS_ACCESS_KEY_ID="" AWS_SECRET_ACCESS_KEY="" AWS_REGION="" AWS_BEDROCK_MODEL_LIST="" \
    # Azure OpenAI
    AZURE_API_KEY="" AZURE_API_VERSION="" AZURE_ENDPOINT="" AZURE_MODEL_LIST="" \
    # Baichuan
    BAICHUAN_API_KEY="" BAICHUAN_MODEL_LIST="" \
    # Cloudflare
    CLOUDFLARE_API_KEY="" CLOUDFLARE_BASE_URL_OR_ACCOUNT_ID="" CLOUDFLARE_MODEL_LIST="" \
    # Cohere
    COHERE_API_KEY="" COHERE_MODEL_LIST="" COHERE_PROXY_URL="" \
    # ComfyUI
    ENABLED_COMFYUI="" COMFYUI_BASE_URL="" COMFYUI_AUTH_TYPE="" \
    COMFYUI_API_KEY="" COMFYUI_USERNAME="" COMFYUI_PASSWORD="" COMFYUI_CUSTOM_HEADERS="" \
    # DeepSeek
    DEEPSEEK_API_KEY="" DEEPSEEK_MODEL_LIST="" \
    # Fireworks AI
    FIREWORKSAI_API_KEY="" FIREWORKSAI_MODEL_LIST="" \
    # Gitee AI
    GITEE_AI_API_KEY="" GITEE_AI_MODEL_LIST="" \
    # GitHub
    GITHUB_TOKEN="" GITHUB_MODEL_LIST="" \
    # Google
    GOOGLE_API_KEY="" GOOGLE_MODEL_LIST="" GOOGLE_PROXY_URL="" \
    # Groq
    GROQ_API_KEY="" GROQ_MODEL_LIST="" GROQ_PROXY_URL="" \
    # Higress
    HIGRESS_API_KEY="" HIGRESS_MODEL_LIST="" HIGRESS_PROXY_URL="" \
    # HuggingFace
    HUGGINGFACE_API_KEY="" HUGGINGFACE_MODEL_LIST="" HUGGINGFACE_PROXY_URL="" \
    # Hunyuan
    HUNYUAN_API_KEY="" HUNYUAN_MODEL_LIST="" \
    # InternLM
    INTERNLM_API_KEY="" INTERNLM_MODEL_LIST="" \
    # Jina
    JINA_API_KEY="" JINA_MODEL_LIST="" JINA_PROXY_URL="" \
    # Minimax
    MINIMAX_API_KEY="" MINIMAX_MODEL_LIST="" \
    # Mistral
    MISTRAL_API_KEY="" MISTRAL_MODEL_LIST="" \
    # ModelScope
    MODELSCOPE_API_KEY="" MODELSCOPE_MODEL_LIST="" MODELSCOPE_PROXY_URL="" \
    # Moonshot
    MOONSHOT_API_KEY="" MOONSHOT_MODEL_LIST="" MOONSHOT_PROXY_URL="" \
    # Nebius
    NEBIUS_API_KEY="" NEBIUS_MODEL_LIST="" NEBIUS_PROXY_URL="" \
    # NewAPI
    NEWAPI_API_KEY="" NEWAPI_PROXY_URL="" \
    # Novita
    NOVITA_API_KEY="" NOVITA_MODEL_LIST="" \
    # Nvidia NIM
    NVIDIA_API_KEY="" NVIDIA_MODEL_LIST="" NVIDIA_PROXY_URL="" \
    # Ollama
    ENABLED_OLLAMA="" OLLAMA_MODEL_LIST="" OLLAMA_PROXY_URL="" \
    # OpenAI
    ENABLED_OPENAI="" OPENAI_API_KEY="" OPENAI_MODEL_LIST="" OPENAI_PROXY_URL="" \
    # OpenRouter
    OPENROUTER_API_KEY="" OPENROUTER_MODEL_LIST="" \
    # Perplexity
    PERPLEXITY_API_KEY="" PERPLEXITY_MODEL_LIST="" PERPLEXITY_PROXY_URL="" \
    # PPIO
    PPIO_API_KEY="" PPIO_MODEL_LIST="" \
    # Qiniu
    QINIU_API_KEY="" QINIU_MODEL_LIST="" QINIU_PROXY_URL="" \
    # Qwen
    QWEN_API_KEY="" QWEN_MODEL_LIST="" QWEN_PROXY_URL="" \
    # SambaNova
    SAMBANOVA_API_KEY="" SAMBANOVA_MODEL_LIST="" \
    # Search1API
    SEARCH1API_API_KEY="" SEARCH1API_MODEL_LIST="" \
    # SenseNova
    SENSENOVA_API_KEY="" SENSENOVA_MODEL_LIST="" \
    # SiliconCloud
    SILICONCLOUD_API_KEY="" SILICONCLOUD_MODEL_LIST="" SILICONCLOUD_PROXY_URL="" \
    # Spark
    SPARK_API_KEY="" SPARK_MODEL_LIST="" SPARK_PROXY_URL="" SPARK_SEARCH_MODE="" \
    # Stepfun
    STEPFUN_API_KEY="" STEPFUN_MODEL_LIST="" \
    # Taichu
    TAICHU_API_KEY="" TAICHU_MODEL_LIST="" \
    # TogetherAI
    TOGETHERAI_API_KEY="" TOGETHERAI_MODEL_LIST="" \
    # Upstage
    UPSTAGE_API_KEY="" UPSTAGE_MODEL_LIST="" \
    # v0 (Vercel)
    V0_API_KEY="" V0_MODEL_LIST="" \
    # vLLM
    VLLM_API_KEY="" VLLM_MODEL_LIST="" VLLM_PROXY_URL="" \
    # Wenxin
    WENXIN_API_KEY="" WENXIN_MODEL_LIST="" \
    # xAI
    XAI_API_KEY="" XAI_MODEL_LIST="" XAI_PROXY_URL="" \
    # Xinference
    XINFERENCE_API_KEY="" XINFERENCE_MODEL_LIST="" XINFERENCE_PROXY_URL="" \
    # 01.AI
    ZEROONE_API_KEY="" ZEROONE_MODEL_LIST="" \
    # Zhipu
    ZHIPU_API_KEY="" ZHIPU_MODEL_LIST="" \
    # Tencent Cloud
    TENCENT_CLOUD_API_KEY="" TENCENT_CLOUD_MODEL_LIST="" \
    # Infini-AI
    INFINIAI_API_KEY="" INFINIAI_MODEL_LIST="" \
    # 302.AI
    AI302_API_KEY="" AI302_MODEL_LIST="" \
    # FAL
    ENABLED_FAL="" FAL_API_KEY="" FAL_MODEL_LIST="" \
    # BFL
    BFL_API_KEY="" BFL_MODEL_LIST="" \
    # Vercel AI Gateway
    VERCELAIGATEWAY_API_KEY="" VERCELAIGATEWAY_MODEL_LIST="" \
    # Cerebras
    CEREBRAS_API_KEY="" CEREBRAS_MODEL_LIST=""

USER nextjs

EXPOSE 3210/tcp

ENTRYPOINT ["/bin/node"]

CMD ["/app/startServer.js"]
