# MarkItDown conversion sidecar for the ChatHub Knowledge Base.
#
# Build from the repository root:
#   docker build -t chathub-markitdown -f docker/markitdown/Dockerfile docker/markitdown
FROM python:3.12-slim-bookworm

ARG USE_CN_MIRROR

# `exiftool` supplies image and audio metadata; `ffmpeg` lets pydub transcode
# mp3/mp4 to wav for speech transcription. Without them those converters still
# run, they just have far less to report.
RUN \
    if [ "${USE_CN_MIRROR:-false}" = "true" ]; then \
        sed -i "s/deb.debian.org/mirrors.ustc.edu.cn/g" /etc/apt/sources.list.d/debian.sources; \
    fi \
    && apt-get update \
    && apt-get install --no-install-recommends -y exiftool ffmpeg \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/* /tmp/* /var/tmp/*

ENV EXIFTOOL_PATH="/usr/bin/exiftool" \
    PIP_DISABLE_PIP_VERSION_CHECK="1" \
    PIP_NO_CACHE_DIR="1" \
    PYTHONDONTWRITEBYTECODE="1" \
    PYTHONUNBUFFERED="1"

WORKDIR /app

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# LLM-vision OCR for scanned PDFs and pictures embedded in Office documents.
# Off by default: it is installed from a git subdirectory and pulls PyMuPDF, so
# it should not be able to break the base build.
ARG INSTALL_OCR_PLUGIN=false
RUN if [ "${INSTALL_OCR_PLUGIN}" = "true" ]; then \
        pip install --no-cache-dir \
        "markitdown-ocr @ git+https://github.com/microsoft/markitdown.git@v0.1.7#subdirectory=packages/markitdown-ocr"; \
    fi

COPY server.py ./

# Conversion reads whatever the process can reach, so drop privileges and keep
# no writable application directory.
USER nobody:nogroup

EXPOSE 5000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:5000/health', timeout=4).status == 200 else 1)"

CMD ["uvicorn", "server:app", "--host", "0.0.0.0", "--port", "5000"]
