# Knowledge Base and Vector RAG

ChatHub Knowledge uses a dedicated external embedding provider and PostgreSQL
pgvector. It does not infer an embedding model from the selected chat model,
chat-provider credentials, or `DEFAULT_FILES_CONFIG`. Without a complete RAG
provider configuration, document parsing can still run, but vector indexing,
semantic search, chat retrieval, and RAG evaluations are unavailable.

## Content boundary

Knowledge is document-only. `isChunkableFile` is the shared positive capability
check used by upload, file queries, Knowledge Base association, parse actions,
and reindexing. Supported inputs are PDF, DOCX, PPTX, EPUB, CSV, Markdown,
LaTeX, plain text, and the text/source extensions routed by the LangChain
loaders. Legacy DOC, spreadsheets, SQLite/database files, images, audio, video,
archives, and unknown binary formats are rejected or hidden. The explicit
database-extension rejection wins even when a file is mislabeled as plain
text. ZIP is accepted only as an upload transport; extracted entries are
filtered before any file row is created.

This boundary does not delete or relocate other media:

- screenshots and media attached during a topic remain topic files and skip chunking
- generated images remain available through the Image workflow and Artifacts
- an old unsupported file relation is hidden from Knowledge but the underlying file remains owned by the account

The loader uses 1,000-character chunks with 200-character overlap. Parsed text
is UTF-8 sanitized, trimmed, and stripped of blank chunks. Re-parsing replaces
old chunks, unstructured elements, relations, and cascading embeddings in one
transaction so a file cannot expose a mixed old/new index.

MarkItDown conversion enters the Markdown loader through
`ContentChunk.chunkByMarkItDown`. Before splitting, `normalizeMarkdownTables`
repairs a GFM separator that was merged onto a header line. The loader then
extracts each valid table block and emits it as one atomic document, while the
existing `MarkdownTextSplitter` continues to split prose. This prevents
`chunkOverlap` from detaching or duplicating a table separator. It only affects
new parses; older persisted malformed table chunks must be re-parsed.

## Provider resolution

`src/server/services/rag/embedding.ts` owns provider resolution and HTTP
adapters. Resolution order is:

1. a complete encrypted `keyVaults.rag` override for the current account
2. a complete deployment environment configuration
3. unavailable

An invalid account override is authoritative and blocks environment fallback
until the user corrects it or selects **Use environment configuration**. A
partial environment configuration is also reported as invalid. Provider status
returns only readiness, source, provider, model, dimensions, a credential-free
identity fingerprint, and whether a saved key exists. It never returns an API
key.

RAG settings mutations use an authenticated key-vault read. If existing
ciphertext cannot be decrypted, save and clear operations fail before writing;
they never replace the rest of the vault with an empty object. This usually
indicates a changed `KEY_VAULTS_SECRET`. Normal user bootstrap omits the
server-only `keyVaults.rag` entry, and generic settings writes preserve it, so
the RAG API key is managed only by the dedicated provider endpoints.

Supported adapters are:

| Provider | Default model             | Request contract                                     |
| -------- | ------------------------- | ---------------------------------------------------- |
| OpenAI   | `text-embedding-3-small`  | `/embeddings`, `dimensions: 1024`                    |
| Cohere   | `embed-multilingual-v3.0` | `/v2/embed`, float output, query/document input type |
| Voyage   | `voyage-3.5`              | `/embeddings`, `output_dimension: 1024`              |

Custom HTTP(S) base URLs and model IDs are allowed. A base URL is an API root,
not a credential carrier: URL user information, query parameters, and
fragments are rejected, and authentication belongs only in the API-key field.
Every response must contain exactly one finite 1,024-dimensional vector per
input. Any other shape fails the task and cannot become searchable. Invalid
legacy base URLs are omitted from provider status instead of being echoed to
the browser.

## Vector identity and storage

The provider, normalized credential-free endpoint, model, and fixed dimension
are hashed into an opaque RAG fingerprint. API-key rotation preserves the
fingerprint; changing provider, endpoint, model, or dimensions changes it.
Every document and cached query embedding stores that fingerprint in
`embeddings.model`.

PostgreSQL owns durable vectors. Migration `0005_pgvector.sql` enables the
vector extension, the `embeddings.embeddings` column is `vector(1024)`, and
`0053_add_rag_embedding_indexes.sql` adds:

- a B-tree index on `(user_id, model)` for current-fingerprint filtering
- a partial HNSW index using `vector_cosine_ops` for document-chunk nearest-neighbor search

Drizzle applies migrations in a transaction, so the HNSW index is created with
regular `CREATE INDEX`; PostgreSQL does not allow `CREATE INDEX CONCURRENTLY`
inside that transaction. The regular build permits reads but blocks writes to
`embeddings` until it finishes. Before upgrading an installation with a large
embedding table, estimate the build time and schedule a maintenance window.

Semantic queries order by the raw cosine-distance operator ascending so
pgvector can use HNSW, while selecting `1 - distance` as the returned
similarity. Retrieval reads at most 24 nearest candidates, keeps similarity at
or above 0.2, and returns at most 8 chunks. The HNSW predicate requires a
non-null `chunk_id`, so cached message/evaluation query vectors do not consume
document nearest-neighbor candidates.

## Chat retrieval and transient context

When enabled Knowledge is attached to an assistant, chat RAG remains automatic.
If the current message has history and no cached RAG query, the internal query
rewrite model first produces the semantic-search query. There is no user-facing
per-document embedding switch or per-message retrieval tool: parsing starts
embedding by default, `CHUNKS_AUTO_EMBEDDING=0` disables that automatic handoff
deployment-wide, and explicit reindex controls remain available. Provider
readiness still governs whether usable vectors exist.

The retrieval result is rendered into the full
`<knowledge_base_qa_info>` prompt block and appended to a cloned latest-user
message for the initial provider request. This block is not persisted in chat
history and is cleared before tool continuations, but it consumes context tokens
while that request is active. The regular context popover exposes the resulting
token count in a `Knowledge Base` bucket. It never performs speculative
retrieval to estimate the block.

Prompt token accounting is best-effort and cannot block the provider request.
For inputs up to 10,000 characters, the browser first tries exact
`gpt-tokenizer` counting in a Web Worker. Worker construction, posting,
decoding, runtime errors, and a three-second timeout reject that exact attempt;
the Knowledge path then uses `tokenx` estimation and finally character length
if estimation also fails. The shared worker uses opaque request IDs and clears
all pending work before it is recreated after a worker-level failure.

`Context Export Next Request` adds the resulting bucket and a bounded summary
containing `countMode` (`exact`, `estimated`, or `character`), rewrite state,
scope counts, candidate/threshold/result counts, selected cosine scores, and
the diagnostic ID when available. The sanitized Engineered Context already
carries the actual injected prompt, regardless of the token-count mode.

## Indexing lifecycle

File parsing and embedding are separate async tasks. Embedding runs in batches
of 50 with concurrency 3 and replaces any vector for the same chunk. A task is
successful only when every current file chunk has an embedding with the active
fingerprint. File readiness also requires the current embedding task to be
successful; stale vectors from a previous provider are never reported as ready
or included in production retrieval. Each batch locks the file row and verifies
that its task is still current, so a superseded retry cannot overwrite vectors
written by a newer task.

Saving a provider identity change reports whether existing chunk embeddings
need reindexing. The settings UI then offers an explicit bulk reindex of all
owned, parsed, chunkable documents. Removing an account override can require
the same reindex when the environment identity differs.

Query embeddings cached on message RAG records are reused only when both the
rewrite query and active fingerprint match. Otherwise the old cached vector is
replaced. RAG evaluation records use the same provider and reject continuation
after the provider identity changes.

## Ownership and failure behavior

Files, Knowledge Bases, junction rows, chunks, embeddings, async tasks, and
message-query vectors are scoped to the authenticated user in both reads and
writes. Adding existing files validates ownership and chunkability atomically.
Knowledge expansion joins through an owned Knowledge Base and owned files.

Provider absence is explicit: Knowledge renders a warning banner linking to
**Settings -> RAG Provider**, direct indexing/search calls fail a precondition,
and chat retrieval surfaces the failure rather than silently returning an empty
result. Provider HTTP errors and invalid vector shapes are recorded on the
embedding task with readable messages.

Server-mode chat reserves and persists the assistant placeholder before client
RAG prompt preparation. Any remaining preparation failure is converted into an
`UnknownChatFetchError` containing the opaque Knowledge diagnostic ID when one
is available. The client updates the live row, persists the error, and refreshes
the conversation, so a failed request renders an error instead of leaving a
permanent `...` placeholder after reload. Tokenizer failure alone no longer
enters this error path because accounting uses the fallbacks above.

### File-object lifecycle and recovery

`global_files` deduplicates uploaded content by SHA-256 hash, while one or more
owned `files` rows and Knowledge Base junction rows can reference the canonical
object. Hash checks therefore verify both the database record and the object
storage key. Legacy rows that contain a full storage URL are normalized back to
their object key before reads, existence checks, and deletion.

If the canonical object is missing, the hash check requests a fresh upload
instead of reusing the stale record. File creation then repairs the
`global_files` entry and every `files` row with that hash, preserving existing
Knowledge Base associations. A missing object during parsing is recorded as a
readable async-task error; it never implicitly deletes the file row or its
Knowledge Base junction.

PDF parsing can also return no chunks when the document is image-only and has no
OCR text layer, encrypted or password-protected, malformed/truncated, empty, or
encoded with structures the current loader cannot extract. These are distinct
from an object-storage `NoSuchKey` failure, which means the stored source object
cannot be read. Re-uploading repairs a missing object reference; image-only PDFs
need OCR before upload, while protected or malformed PDFs must be decrypted or
re-exported.

Explicit deletion removes an object from storage only after the final file row
for its hash is gone and global-file removal is enabled. Bulk deletion returns
one cleanup candidate per newly unreferenced hash, so removing one of several
deduplicated rows cannot delete storage still used by another account or
Knowledge Base. A file without a deduplication hash owns its storage object
directly, so deleting that row still schedules its object for cleanup.

## Structured Knowledge diagnostics

`CHATHUB_KNOWLEDGE_DEBUG=1` enables standalone, versioned JSON lifecycle records
prefixed with `[chathub-knowledge-debug:<event>]`. Correlation covers document
registration/repair, Knowledge Base association, task dispatch, object reads,
chunking, embedding batches/provider calls, reindexing, query embedding, scope
expansion, vector search, retrieval, and client prompt injection. Async dispatch
propagates `x-chathub-knowledge-diagnostic-id` only on requests authenticated
with the internal bearer secret. Relevant chunking, embedding, and retrieval
errors surface the same opaque `kb_...` diagnostic ID in task/UI errors.

The successful client boundary reports `prompt_injection_reported` with
`countMode`. `client_preparation_failed` reports a categorical `failurePhase`:
`retrieval`, `prompt_assembly`, `token_accounting`, or `message_metadata`.
These fields distinguish a healthy server retrieval from a browser-side
preparation failure without recording raw browser error text.

Safe records contain enumerated outcomes, counts, timings, dimensions, and
bounded similarity data. `verbose` adds shapes and HMAC fingerprints keyed by
`KEY_VAULTS_SECRET` or `NEXT_AUTH_SECRET`; without a fingerprint key those
verbose additions fail closed with a configuration warning. Neither level logs
raw filenames, document/chunk/query/prompt text, arbitrary error messages, URLs,
credentials, private database identifiers, request/response bodies, or stacks.
Each record is capped at 16 KiB. Diagnostics do not change retrieval, chunking,
embedding, or reranking behavior.

## File Preview and ChunkDrawer pagination

The shared `src/features/ChunkPager` renders Markdown one chunk at a time for
both the chat File Preview popup and the FileManager ChunkDrawer. It is
container-width responsive rather than viewport responsive: wide panes use
numbered pages and a quick jumper, medium panes collapse the page range, and
narrow panes use compact simple pagination. First/last `ActionIcon` jumpers
remain available at every density; the control row never wraps. The content
surface scales its reading rhythm for narrow panes and makes wide tables
horizontally scrollable.

The chat File Preview popup (`src/features/Portal/FilePreview/Body/`) renders
retrieved Knowledge chunks and whole source files. Both the **Chunk** tab
(retrieved chunks for a message) and the **File** tab (all chunks of a file)
are chunk-paginated one chunk per page through that shared component. The
previous single-scrollable markdown blob is replaced by chunk paging so very
large Knowledge documents stay navigable.

Data flow:

- A chat chunk citation calls `openFilePreview({ fileId, chunkId, chunks })`
  in the chat portal slice; `chunks` carries the message's retrieved
  `ChatFileChunk[]` list so the **Chunk** tab can page client-side without a
  new request, starting at the clicked `chunkId`.
- The **File** tab fetches all chunks of the file in one request via the
  `chunk.getAllByFileId` tRPC procedure (`ChunkModel.findAllByFileId`,
  ordered by `asc(chunks.index)`, returns plain `chunk.text` — no
  `mapChunkText` decoration, since this is a user-facing viewer and the
  Table-chunk `text_as_html` scaffold would render as literal markup).
  The `useQuery` is gated by file type (PDF/image skip it) and pinned with
  a 5-minute `staleTime` since chunk content is immutable once embedded.
  PDF and image files skip chunking and keep `FileViewer` (PDF.js paginates
  by PDF page; images render natively). Non-PDF text documents with zero
  chunks fall back to `FileViewer`.

The FileManager `ChunkDrawer/ChunkList` also uses
`chunk.getAllByFileId`, with the same five-minute `staleTime` and a
refetch-on-parsing-completion transition. It derives the selected chunk's
provenance header from the pager page. This deliberately trades a potentially
large all-chunk response for direct numbered navigation; revisit server-side
page loading if real files make the payload too large.

Office preview types are routed from both list and masonry file cards directly
to the ChunkDrawer, even with zero chunks. The external Office Online renderer
cannot fetch private self-hosted URLs. The drawer therefore displays a local
empty state with `parseFilesToChunks([fileId])`, polls during parsing, then
fetches the completed chunks.

## Source map

- `packages/types/src/rag.ts`
- `packages/utils/src/isChunkableFile.ts`
- `packages/utils/src/tokenizer/client.ts`
- `src/envs/knowledge.ts`
- `src/server/modules/S3/index.ts`
- `src/server/services/chunk/index.ts`
- `src/server/services/file/index.ts`
- `src/server/services/rag/embedding.ts`
- `src/libs/logger/knowledgeDebug.ts`
- `src/store/chat/helpers/knowledgeBaseContext.ts`
- `src/store/chat/slices/aiChat/actions/generateAIChatV2.ts`
- `src/server/routers/async/file.ts`
- `src/server/routers/lambda/chunk.ts`
- `src/server/routers/lambda/file.ts`
- `src/server/routers/lambda/ragProvider.ts`
- `packages/database/src/models/chunk.ts`
- `packages/database/src/models/embedding.ts`
- `packages/database/src/models/file.ts`
- `packages/database/src/schemas/rag.ts`
- `src/features/ChunkPager/index.tsx`
- `src/features/FileManager/ChunkDrawer/ChunkList/index.tsx`
- `src/features/FileManager/FileList/FileListItem/index.tsx`
- `src/features/FileManager/FileList/MasonryFileItem/index.tsx`
- `src/features/Portal/FilePreview/Body/index.tsx`
- `src/libs/langchain/loaders/markdown/tables.ts`
- `src/server/modules/ContentChunk/index.ts`
- `src/store/chat/slices/portal/initialState.ts`
