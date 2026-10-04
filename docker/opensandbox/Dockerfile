# General-purpose image for ChatHub's Sandbox tool on OpenSandbox.
# OpenSandbox injects execd; ChatHub needs bash and python3 on PATH, and the
# model expects the usual development tools: git, Node.js, build tools, and
# common CLIs. Build it on the host that runs the OpenSandbox server, then set
# OPENSANDBOX_IMAGE to the tag:
#   docker build -t chathub-sandbox:1 docker/opensandbox
# Both stages use the same Debian release, so the copied Node.js binary links
# against the glibc it was built for.
FROM node:24-trixie-slim AS node

FROM python:3.12-slim-trixie

# WenQuanYi Zen Hei ships as a TrueType collection. ReportLab 5.0.1 treats the
# 'ttcf' scaler (0x74746366) as a collection and embeds subfont 0
# (pdfbase/ttfonts.py TTFontParser.ttfVersions / readTTCHeader), so this link
# is the STSong.ttf the prompt opens. The runner also links it into the workdir.
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        build-essential \
        ca-certificates \
        curl \
        file \
        fonts-dejavu-core \
        fonts-wqy-zenhei \
        git \
        jq \
        less \
        openssh-client \
        procps \
        ripgrep \
        sqlite3 \
        unzip \
        wget \
        xz-utils \
        zip \
    && rm -rf /var/lib/apt/lists/* \
    && ln -s /usr/share/fonts/truetype/wqy/wqy-zenhei.ttc /usr/share/fonts/truetype/STSong.ttf

# Node.js LTS with npm and corepack from the official image; pnpm and yarn
# are installed globally so they work without a download at first use.
COPY --from=node /usr/local/bin/node /usr/local/bin/node
COPY --from=node /usr/local/lib/node_modules /usr/local/lib/node_modules
RUN ln -s ../lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm \
    && ln -s ../lib/node_modules/npm/bin/npx-cli.js /usr/local/bin/npx \
    && ln -s ../lib/node_modules/corepack/dist/corepack.js /usr/local/bin/corepack \
    && npm install --global pnpm yarn \
    && npm cache clean --force \
    && node --version && npm --version && pnpm --version && yarn --version

# Commands run as root inside the sandbox; keep pip quiet about it, and let
# git commit without asking for an identity first.
ENV PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PIP_ROOT_USER_ACTION=ignore
RUN git config --system init.defaultBranch main \
    && git config --system user.name "ChatHub Sandbox" \
    && git config --system user.email "sandbox@localhost"

COPY requirements.txt /tmp/requirements.txt
RUN pip install --no-cache-dir -r /tmp/requirements.txt && rm /tmp/requirements.txt

COPY matplotlibrc /etc/matplotlibrc
ENV MATPLOTLIBRC=/etc/matplotlibrc
COPY sitecustomize.py /tmp/sitecustomize.py
RUN mv /tmp/sitecustomize.py "$(python3 -c 'import sysconfig; print(sysconfig.get_paths()["purelib"])')/"

# Build the matplotlib font cache once instead of on every run.
RUN python3 -c "import matplotlib.pyplot"

# Matches the Sandbox tool's working directory (src/tools/sandbox/const.ts).
WORKDIR /tmp/workspace
