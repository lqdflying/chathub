# MarkItDown sidecar

Converts uploaded documents to Markdown so the ChatHub Knowledge Base can embed
formats the built-in loaders cannot read, and so the ones it can read arrive as
structured Markdown (headings and tables survive chunking) instead of flat text.

It wraps [Microsoft MarkItDown](https://github.com/microsoft/markitdown) 0.1.7 in
a two-endpoint HTTP API. It runs as a separate container because MarkItDown is
Python and the ChatHub runtime image is distroless — node only, no interpreter
and no package manager.

## Run it

```bash
docker compose -f docker/markitdown/docker-compose.yml up -d --build
```

Then point ChatHub at it and restart ChatHub:

```bash
MARKITDOWN_SERVICE_URL=http://markitdown:5000
```

Use `http://127.0.0.1:5000` if ChatHub is not on the same Docker network. Once
the variable is set, MarkItDown becomes the preferred converter for every
upload, with the previous LangChain loaders kept as the fallback.

Verify it is up:

```bash
curl -s http://127.0.0.1:5000/health
curl -s -F file=@some.xlsx http://127.0.0.1:5000/convert | head -c 400
```

## What it adds

Formats the Knowledge Base accepts only when this service is configured:

| Kind | Formats |
| --- | --- |
| Spreadsheets | `.xlsx` `.xls` — one Markdown table per sheet |
| Mail | `.msg` (Outlook) |
| Notebooks | `.ipynb` — cells as fenced code blocks |
| Archives | `.zip` — converts each member and concatenates |
| Feeds | `.rss` `.atom` `.xml` |
| Images | `.png` `.jpg` `.jpeg` — EXIF metadata, plus captions/OCR when an LLM is configured |
| Audio | `.wav` `.mp3` `.m4a` `.mp4` — metadata plus speech transcription |
| Other | `.htm` `.jsonl` `.text` |

Formats that already worked keep working, now via MarkItDown: PDF (with
geometric table detection), `.docx` (including equations, as LaTeX), `.pptx`
(per-slide headings, speaker notes, chart data), `.epub`, `.csv`, `.html`.

`.doc` and `.docm` remain unsupported — MarkItDown has no converter for legacy
Word either.

## API

`GET /health` → `{"status":"ok","version":"0.1.7","plugins":false,...}`

`POST /convert` → `{"markdown":"...","title":null,"chars":123,"durationMs":45}`

Multipart fields: `file` (required), `filename` and `mime_type` (optional hints
that improve format detection). Send `Authorization: Bearer $MARKITDOWN_API_KEY`
when that variable is set.

Status codes: `401` bad token, `413` over the size cap, `415` no converter for
the format, `422` conversion failed, `501` a converter's optional dependency is
missing. ChatHub treats all of them as "fall back to the built-in loaders".

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `MARKITDOWN_API_KEY` | — | Require this bearer token on `/convert` |
| `MARKITDOWN_MAX_FILE_SIZE` | `104857600` | Reject larger uploads (bytes) |
| `MARKITDOWN_ENABLE_PLUGINS` | `false` | Load `markitdown.plugin` entry points |
| `MARKITDOWN_KEEP_DATA_URIS` | `false` | Inline images as base64. Leave off: base64 blobs waste embedding tokens |
| `MARKITDOWN_LLM_BASE_URL` | — | OpenAI-compatible endpoint for image captioning |
| `MARKITDOWN_LLM_API_KEY` | — | Captioning requires both the key and the model |
| `MARKITDOWN_LLM_MODEL` | — | e.g. `gpt-4o` |
| `MARKITDOWN_LLM_PROMPT` | MarkItDown's default | Override the captioning prompt |
| `AZURE_DOC_INTEL_ENDPOINT` | — | Use Azure Document Intelligence `prebuilt-layout` |
| `AZURE_CU_ENDPOINT` | — | Use Azure Content Understanding |
| `AZURE_CU_ANALYZER_ID` | — | Custom Content Understanding analyzer |
| `AZURE_API_KEY` | — | Credential for either Azure service |

`exiftool` and `ffmpeg` are installed in the image, so image/audio metadata and
speech transcription work without further setup.

### Scanned documents

Images and scanned PDFs carry no extractable text. Without OCR, MarkItDown
returns only EXIF metadata for an image — often nothing — and ChatHub reports
"no chunk found". Two ways to fix that:

1. Set `MARKITDOWN_LLM_*` and rebuild with `INSTALL_OCR_PLUGIN=true`, which adds
   LLM-vision OCR for scanned pages and pictures embedded in Office documents.
2. Set `AZURE_DOC_INTEL_ENDPOINT` to use Azure's OCR instead.

## Security

Conversion reads whatever the process can reach, so treat this as an internal
service:

- The Compose file binds it to `127.0.0.1` and drops privileges to
  `nobody:nogroup`. Do not expose it publicly.
- Set `MARKITDOWN_API_KEY` if anything other than ChatHub can route to it — the
  service is unauthenticated otherwise.
- Audio transcription sends audio to Google's free Web Speech endpoint, and the
  YouTube converter fetches transcripts, so those paths leave your network.
  Everything else converts locally.
