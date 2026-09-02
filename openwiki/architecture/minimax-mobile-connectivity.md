# MiniMax mobile Connectivity Check — end-to-end lesson

## Outcome

MiniMax-M3 Connectivity Check failed consistently on mobile while the same
provider configuration passed on desktop and other providers passed on the same
phone. The final fix shipped in `v2.0.3-canary.7` and was confirmed on the
physical mobile device on 2026-09-02.

The decisive fault was **before the HTTP transport**, not in MiniMax and not in
the response parser. MiniMax's context guard started the browser tokenizer
worker even for the one-message health probe. That worker can be unavailable or
time out in a mobile Safari tab or installed PWA, so request preparation failed
before the API call began.

The durable rule is:

> A tiny health check must not depend on heavyweight, optional browser
> infrastructure that is irrelevant to proving connectivity.

## Symptom pattern

The useful matrix was:

| Environment | MiniMax Check | Other provider Check |
| --- | --- | --- |
| Desktop browser | Pass | Pass |
| Mobile browser/PWA | Fail | Pass |

The original UI reported `ConnectionCheckFailed` with “The request returned
empty.” That message described the final UI state, but did not prove that an
empty provider response existed. A request-preparation exception could reach
the same fallback.

`v2.0.3-canary.6` added content-free boundary diagnostics. The decisive device
screenshot contained only:

```json
{
  "clientVersion": "2.0.3-canary.6"
}
```

This established two facts:

1. The phone had loaded the current bundle, so stale PWA assets were not the
   explanation.
2. Neither `transport` nor `jsonResponse` existed, so the failure occurred
   before a JSON response reached the client inspector. A fetch/parse failure
   would also have supplied its error kind and reason.

## Investigation sequence

Several transport and response issues were real possibilities and deserved
coverage, but were not the last blocker:

1. **Short SSE on Safari.** Mobile WebKit can end a short event stream with
   `TypeError: Load failed` without exposing its bytes. Raw-byte recovery made
   the SSE fallback safer.
2. **Connectivity did not need streaming.** Check switched to a non-streaming
   upstream request and `application/json` client handling. Runtimes that still
   return `text/event-stream` retain the existing SSE fallback.
3. **A completed response can expose no assistant text.** MiniMax Check accepts
   a successful terminal JSON envelope (`base_resp.status_code === 0` plus a
   choice finish reason), while malformed or provider-error envelopes still
   fail. Content-free inspection records types, lengths, bounded keys, finish
   reason, and provider status—not model output.
4. **The device still failed before those boundaries.** The canary.6 screenshot
   omitted every transport/JSON field. Tracing the MiniMax-only pre-transport
   path exposed `trimMinimaxChatContext` and its tokenizer worker as the
   remaining mobile-specific dependency.

The important debugging correction was to stop interpreting “returned empty”
as an upstream fact. Once diagnostics were attached at boundaries, the absence
of later-boundary fields located the failure earlier in the pipeline.

## Final design

`trimMinimaxChatContext` serializes messages and tools, then obtains the UTF-8
byte length before attempting exact tokenization.

- Byte-level BPE cannot produce more tokens than the UTF-8 bytes it starts
  from. If byte length is within the prompt budget, the request is proven safe
  and returns immediately without starting a worker.
- Requests above that conservative bound retain the existing exact/estimated
  token path.
- If tokenization fails, UTF-8 byte length is the conservative fallback. It may
  trim earlier than necessary, but cannot expand a request beyond the budget.

This is broader than a one-off connectivity exception: short MiniMax chats no
longer need a worker merely to prove they are far below the context limit, while
large histories keep the trimming protection that prevents MiniMax error 2013.

Checker errors without a structured provider error also include a content-free
pre-transport reason and error class. Future failures should not collapse to
only a generic empty-result message.

## Diagnostic decision tree

For a future Connectivity Check failure, read **Show Details** in this order:

| Evidence | Likely boundary | Next action |
| --- | --- | --- |
| New expected fields are absent, including `clientVersion` | Stale client bundle | Fully close and reopen the tab/PWA; confirm deployed image version |
| `clientVersion` only | Before transport/structured error handling | Inspect provider-specific request preparation, context shaping, workers, and synchronous setup |
| `reason: json_chat_fetch_failed` | Fetch did not yield a response | Check browser networking, proxy reachability, TLS/CORS, and abort state |
| `reason: json_chat_parse_failed` | Response arrived but JSON parsing failed | Check media type, proxy body rewriting, compression, and truncation |
| `transport` plus `jsonResponse` | JSON response reached the inspector | Use content-free shape/status fields to distinguish terminal, incomplete, and provider-error envelopes |
| Structured provider body/status | Upstream rejected the request | Validate model id, `/v1` base URL, credentials, and provider-specific payload fields |

Do not add answer text, prompt text, credentials, URLs containing secrets, or
raw provider bodies to these diagnostics.

## Verification contract

For future changes in this path:

1. Reproduce the environment matrix: desktop/mobile and MiniMax/control
   provider.
2. Run the focused suites:

   ```bash
   bunx vitest run --silent='passed-only' \
     'src/services/chat/trimMinimaxContext.test.ts' \
     'src/services/chat/fetchJsonChatCompletion.test.ts' \
     'src/services/chat/extractJsonChatCompletion.test.ts' \
     'src/app/[variants]/(main)/settings/provider/features/ProviderConfig/connectionCheckParams.test.ts' \
     'src/app/[variants]/(main)/settings/provider/features/ProviderConfig/Checker.test.ts' \
     'src/services/chat/chat.test.ts'
   bun run type-check
   ```

3. Use the required redacted native MiniMax probe from
   `.cursor/rules/minimax-live-probe.mdc`. Report status, latency, terminal
   shape, and usage only.
4. Publish a canary only on explicit instruction. Fully close/reopen the mobile
   tab or PWA after deploying it.
5. Treat physical-device success as the acceptance gate. Desktop tests and a
   successful vendor probe cannot validate a Safari/PWA worker lifecycle.

The resolving round passed 105 focused tests and type-check. Its redacted live
probe returned HTTP 200, MiniMax status 0, one `stop` choice, and normal usage.
The user then confirmed that `v2.0.3-canary.7` finally worked on the affected
mobile device.

## Source map and release trail

- `src/services/chat/trimMinimaxContext.ts` — conservative byte proof and
  tokenizer-failure fallback
- `src/services/chat/fetchJsonChatCompletion.ts` — JSON response handling and
  fetch/parse failure classification
- `src/services/chat/extractJsonChatCompletion.ts` — content-free response
  inspection and terminal-envelope classification
- `src/app/[variants]/(main)/settings/provider/features/ProviderConfig/Checker.tsx`
  — UI settlement and safe failure details
- `src/app/[variants]/(main)/settings/provider/features/ProviderConfig/connectionCheckParams.ts`
  — MiniMax Check payload and success semantics
- Resolving code commit: `fd3414bf4b` (`v2.0.3-canary.7`)
- User-facing procedure: GitHub Wiki `Model-Providers.md`, MiniMax section

Keep the transport, JSON-envelope, and tokenizer protections as separate
layers. The final tokenizer diagnosis does not make the earlier Safari stream
or empty-envelope guards unnecessary; it explains why those guards never ran
on the affected attempt.
