"""HTTP wrapper around Microsoft MarkItDown for the ChatHub Knowledge Base.

MarkItDown is a Python library and the ChatHub runtime image is distroless
(node only), so conversion runs here, out of process. ChatHub POSTs a document
to /convert and embeds the Markdown that comes back.

Configuration (all optional except where noted):
  MARKITDOWN_API_KEY        Bearer token required on /convert when set.
  MARKITDOWN_MAX_FILE_SIZE  Reject larger uploads, in bytes. Default 100 MiB.
  MARKITDOWN_ENABLE_PLUGINS Load third-party `markitdown.plugin` entry points.
  MARKITDOWN_KEEP_DATA_URIS Inline images as base64 data URIs. Off by default:
                            base64 blobs waste embedding tokens.
  MARKITDOWN_LLM_BASE_URL   OpenAI-compatible endpoint used to caption images
  MARKITDOWN_LLM_API_KEY    and, with the markitdown-ocr plugin installed, to
  MARKITDOWN_LLM_MODEL      OCR scanned PDFs and embedded pictures.
  MARKITDOWN_LLM_PROMPT     Override the captioning prompt.
  AZURE_DOC_INTEL_ENDPOINT  Route supported formats through Azure Document
                            Intelligence (prebuilt-layout) instead.
  AZURE_CU_ENDPOINT         Azure Content Understanding endpoint, and
  AZURE_CU_ANALYZER_ID      an optional custom analyzer id.
"""

from __future__ import annotations

import io
import logging
import os
import threading
import time

from fastapi import Depends, FastAPI, File, Form, Header, HTTPException, UploadFile
from markitdown import (
    FileConversionException,
    MarkItDown,
    MissingDependencyException,
    StreamInfo,
    UnsupportedFormatException,
    __version__ as markitdown_version,
)

logging.basicConfig(level=os.environ.get("MARKITDOWN_LOG_LEVEL", "INFO"))
logger = logging.getLogger("markitdown-server")


def _flag(name: str, default: bool = False) -> bool:
    raw = os.environ.get(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


API_KEY = os.environ.get("MARKITDOWN_API_KEY") or None
MAX_FILE_SIZE = int(os.environ.get("MARKITDOWN_MAX_FILE_SIZE") or 100 * 1024 * 1024)
ENABLE_PLUGINS = _flag("MARKITDOWN_ENABLE_PLUGINS")
KEEP_DATA_URIS = _flag("MARKITDOWN_KEEP_DATA_URIS")

app = FastAPI(
    description="Converts documents to Markdown for the ChatHub Knowledge Base.",
    title="MarkItDown service",
)

# One MarkItDown per worker thread. Each instance loads a Magika ONNX model, so
# it is too expensive to build per request, and sharing one across threads would
# mean sharing its detector. FastAPI reuses threadpool threads, so this warms up
# once per thread and then costs nothing.
_local = threading.local()


def _build_llm_client():
    """An OpenAI-compatible client for image captioning, if one is configured."""
    base_url = os.environ.get("MARKITDOWN_LLM_BASE_URL")
    api_key = os.environ.get("MARKITDOWN_LLM_API_KEY")
    model = os.environ.get("MARKITDOWN_LLM_MODEL")

    if not (api_key and model):
        return None, None

    try:
        from openai import OpenAI
    except ImportError:
        logger.warning("MARKITDOWN_LLM_* is set but the openai package is missing")
        return None, None

    return OpenAI(api_key=api_key, base_url=base_url or None), model


def _converter() -> MarkItDown:
    existing = getattr(_local, "markitdown", None)
    if existing is not None:
        return existing

    kwargs: dict[str, object] = {"enable_plugins": ENABLE_PLUGINS}

    llm_client, llm_model = _build_llm_client()
    if llm_client is not None:
        kwargs["llm_client"] = llm_client
        kwargs["llm_model"] = llm_model
        prompt = os.environ.get("MARKITDOWN_LLM_PROMPT")
        if prompt:
            kwargs["llm_prompt"] = prompt

    docintel_endpoint = os.environ.get("AZURE_DOC_INTEL_ENDPOINT")
    if docintel_endpoint:
        kwargs["docintel_endpoint"] = docintel_endpoint

    cu_endpoint = os.environ.get("AZURE_CU_ENDPOINT")
    if cu_endpoint:
        kwargs["cu_endpoint"] = cu_endpoint
        analyzer_id = os.environ.get("AZURE_CU_ANALYZER_ID")
        if analyzer_id:
            kwargs["cu_analyzer_id"] = analyzer_id

    instance = MarkItDown(**kwargs)
    _local.markitdown = instance
    logger.info(
        "MarkItDown ready (plugins=%s, llm=%s, docintel=%s, content_understanding=%s)",
        ENABLE_PLUGINS,
        bool(llm_client),
        bool(docintel_endpoint),
        bool(cu_endpoint),
    )
    return instance


def require_api_key(authorization: str | None = Header(default=None)) -> None:
    if not API_KEY:
        return
    expected = f"Bearer {API_KEY}"
    if authorization != expected:
        raise HTTPException(status_code=401, detail="invalid or missing bearer token")


@app.get("/health")
def health() -> dict[str, object]:
    return {
        "keepDataUris": KEEP_DATA_URIS,
        "maxFileSize": MAX_FILE_SIZE,
        "plugins": ENABLE_PLUGINS,
        "status": "ok",
        "version": markitdown_version,
    }


# Deliberately a `def`, not `async def`: MarkItDown blocks, and FastAPI runs sync
# endpoints in its threadpool so one slow PDF cannot stall the event loop.
@app.post("/convert", dependencies=[Depends(require_api_key)])
def convert(
    file: UploadFile = File(...),
    filename: str | None = Form(default=None),
    mime_type: str | None = Form(default=None),
) -> dict[str, object]:
    data = file.file.read()

    if not data:
        raise HTTPException(status_code=400, detail="empty upload")

    if len(data) > MAX_FILE_SIZE:
        raise HTTPException(
            status_code=413,
            detail=f"{len(data)} bytes exceeds MARKITDOWN_MAX_FILE_SIZE ({MAX_FILE_SIZE})",
        )

    name = filename or file.filename or "document"
    # StreamInfo wants the extension with its leading dot, and an empty string
    # would be treated as a real hint, so normalise to None instead.
    _, _, tail = name.rpartition(".")
    extension = f".{tail.lower()}" if tail and tail != name else None
    mimetype = (mime_type or file.content_type or "").split(";")[0].strip() or None

    stream_info = StreamInfo(
        extension=extension,
        filename=name,
        mimetype=mimetype,
    )

    started = time.monotonic()
    try:
        result = _converter().convert_stream(
            io.BytesIO(data),
            keep_data_uris=KEEP_DATA_URIS,
            stream_info=stream_info,
        )
    except UnsupportedFormatException as error:
        logger.info("unsupported format for %s: %s", name, error)
        raise HTTPException(status_code=415, detail=f"unsupported format: {error}") from error
    except MissingDependencyException as error:
        logger.error("missing dependency converting %s: %s", name, error)
        raise HTTPException(status_code=501, detail=str(error)) from error
    except FileConversionException as error:
        logger.error("failed to convert %s: %s", name, error)
        raise HTTPException(status_code=422, detail=str(error)) from error

    markdown = result.markdown or ""
    duration_ms = int((time.monotonic() - started) * 1000)
    logger.info(
        "converted %s (%s bytes, %s) to %s chars in %sms",
        name,
        len(data),
        mimetype or extension or "unknown type",
        len(markdown),
        duration_ms,
    )

    return {
        "chars": len(markdown),
        "durationMs": duration_ms,
        "markdown": markdown,
        "title": result.title,
    }
