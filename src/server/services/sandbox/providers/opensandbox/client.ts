/**
 * Minimal HTTP client for the OpenSandbox lifecycle server and execd.
 *
 * ChatHub reaches execd only through the lifecycle server's proxy
 * (`/v1/sandboxes/{id}/proxy/{port}`), so the sandbox network never has to be
 * routable from the ChatHub container. The proxy strips
 * `OPEN-SANDBOX-API-KEY` before forwarding, so the key never enters a sandbox.
 * @see https://github.com/opensandbox-group/OpenSandbox/blob/main/specs/sandbox-lifecycle.yml
 * @see https://github.com/opensandbox-group/OpenSandbox/blob/main/specs/execd-api.yaml
 */

export const OPENSANDBOX_API_KEY_HEADER = 'OPEN-SANDBOX-API-KEY';
export const EXECD_PORT = 44_772;

const MAX_ERROR_BODY_CHARS = 500;

export interface OpenSandboxNetworkPolicy {
  defaultAction: 'allow' | 'deny';
  egress: Array<{ action: 'allow' | 'deny'; target: string }>;
}

export interface CreateSandboxRequest {
  entrypoint: string[];
  image: { uri: string };
  metadata?: Record<string, string>;
  networkPolicy?: OpenSandboxNetworkPolicy;
  resourceLimits: Record<string, string>;
  timeout: number;
}

export interface OpenSandboxStreamEvent {
  error?: { ename?: string; evalue?: string; traceback?: string[] };
  results?: Record<string, unknown>;
  text?: string;
  type?: string;
}

export interface ExecdEndpoint {
  headers: Record<string, string>;
  url: string;
}

/** execd `FileInfo`; `mode` is the octal permission written as decimal, e.g. 644. */
export interface ExecdFileInfo {
  mode?: number;
  modifiedAt?: string;
  path: string;
  size: number;
  type: string;
}

// Directory listings are JSON arrays; this bounds what one call may buffer.
export const OPENSANDBOX_LISTING_MAX_BYTES = 4 * 1024 * 1024;

export class OpenSandboxHttpError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'OpenSandboxHttpError';
    this.status = status;
  }
}

// Guest manifests are untrusted. This cap is independent of the per-file cap.
export const OPENSANDBOX_MANIFEST_MAX_BYTES = 256 * 1024;

export class OpenSandboxOutputTooLargeError extends Error {
  readonly limit: number;

  constructor(limit: number) {
    super(`OpenSandbox output exceeded ${limit} bytes.`);
    this.name = 'OpenSandboxOutputTooLargeError';
    this.limit = limit;
  }
}

const declaredLength = (response: Response) => {
  const raw = response.headers.get('content-length');
  if (raw === null || raw.trim() === '') return undefined;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : undefined;
};

// Server timestamps are RFC 3339; one without an offset is UTC, not local time.
const parseTimestamp = (value: unknown) => {
  if (typeof value !== 'string' || !value) return undefined;
  const ms = Date.parse(/(?:z|[+-]\d{2}:?\d{2})$/i.test(value) ? value : `${value}Z`);
  return Number.isFinite(ms) ? ms : undefined;
};

const readCappedBody = async (response: Response, maxBytes: number) => {
  const declared = declaredLength(response);
  if (declared !== undefined && declared > maxBytes) {
    await response.body?.cancel();
    throw new OpenSandboxOutputTooLargeError(maxBytes);
  }
  if (!response.body) {
    const buffered = new Uint8Array(await response.arrayBuffer());
    if (buffered.byteLength > maxBytes) throw new OpenSandboxOutputTooLargeError(maxBytes);
    return buffered;
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    let next = await reader.read();
    while (!next.done) {
      const value = next.value;
      if (value?.byteLength) {
        if (total + value.byteLength > maxBytes) {
          throw new OpenSandboxOutputTooLargeError(maxBytes);
        }
        chunks.push(value);
        total += value.byteLength;
      }
      next = await reader.read();
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  }
  reader.releaseLock();

  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
};

const toFileInfo = (raw: unknown): ExecdFileInfo | undefined => {
  if (!raw || typeof raw !== 'object') return undefined;
  const { mode, modified_at, path, size, type } = raw as Record<string, unknown>;
  if (typeof path !== 'string' || !path) return undefined;
  return {
    mode: typeof mode === 'number' ? mode : undefined,
    modifiedAt: typeof modified_at === 'string' ? modified_at : undefined,
    path,
    size: typeof size === 'number' && Number.isFinite(size) ? size : 0,
    type: typeof type === 'string' ? type : 'other',
  };
};

const readErrorMessage = async (response: Response, fallback: string) => {
  const text = await response.text().catch(() => '');
  let message = text;
  try {
    const parsed = JSON.parse(text) as { message?: unknown };
    if (typeof parsed?.message === 'string') message = parsed.message;
  } catch {
    // Plain-text body; keep it as is.
  }
  message = message.trim().slice(0, MAX_ERROR_BODY_CHARS);
  return message ? `${fallback}: ${message}` : fallback;
};

const ensureOk = async (response: Response, fallback: string) => {
  if (response.ok) return;
  throw new OpenSandboxHttpError(
    response.status,
    await readErrorMessage(response, `${fallback} (HTTP ${response.status})`),
  );
};

/**
 * execd writes one JSON object per line (blank-line separated); standard SSE
 * `data:` framing is accepted as well. Event order is not guaranteed
 * (`execution_complete` can precede `stdout`), so callers read to the end.
 */
export async function* parseEventStream(response: Response): AsyncGenerator<OpenSandboxStreamEvent> {
  if (!response.body) return;
  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf8');
  let buffer = '';

  const parseLine = (raw: string): OpenSandboxStreamEvent | undefined => {
    const line = raw.trim();
    if (!line || line.startsWith(':')) return undefined;
    if (line.startsWith('event:') || line.startsWith('id:') || line.startsWith('retry:')) {
      return undefined;
    }
    const json = line.startsWith('data:') ? line.slice('data:'.length).trim() : line;
    try {
      const parsed = JSON.parse(json) as unknown;
      return parsed && typeof parsed === 'object' ? (parsed as OpenSandboxStreamEvent) : undefined;
    } catch {
      return undefined;
    }
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let index = buffer.indexOf('\n');
      while (index >= 0) {
        const event = parseLine(buffer.slice(0, index));
        buffer = buffer.slice(index + 1);
        if (event) yield event;
        index = buffer.indexOf('\n');
      }
    }
    buffer += decoder.decode();
    const last = parseLine(buffer);
    if (last) yield last;
  } finally {
    // A consumer that stops early (a background start) closes the stream.
    await reader.cancel().catch(() => undefined);
  }
}

export class OpenSandboxClient {
  private readonly apiKey?: string;
  private readonly baseUrl: string;
  private readonly protocol: string;

  constructor({ apiKey, baseUrl }: { apiKey?: string; baseUrl: string }) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.apiKey = apiKey;
    this.protocol = new URL(this.baseUrl).protocol;
  }

  private headers(extra?: Record<string, string>): Record<string, string> {
    return {
      ...(this.apiKey ? { [OPENSANDBOX_API_KEY_HEADER]: this.apiKey } : {}),
      ...extra,
    };
  }

  async createSandbox(body: CreateSandboxRequest, signal: AbortSignal) {
    const response = await fetch(`${this.baseUrl}/v1/sandboxes`, {
      body: JSON.stringify(body),
      headers: this.headers({ 'Content-Type': 'application/json' }),
      method: 'POST',
      signal,
    });
    await ensureOk(response, 'OpenSandbox could not create a sandbox');
    const payload = (await response.json()) as {
      createdAt?: unknown;
      id?: unknown;
      status?: { state?: unknown };
    };
    if (typeof payload.id !== 'string' || !payload.id) {
      throw new OpenSandboxHttpError(response.status, 'OpenSandbox returned no sandbox id.');
    }
    return {
      createdAt: parseTimestamp(payload.createdAt),
      id: payload.id,
      state: typeof payload.status?.state === 'string' ? payload.status.state : undefined,
    };
  }

  async getSandboxStatus(id: string, signal: AbortSignal) {
    const response = await fetch(`${this.baseUrl}/v1/sandboxes/${encodeURIComponent(id)}`, {
      headers: this.headers(),
      signal,
    });
    await ensureOk(response, 'OpenSandbox could not read the sandbox');
    const payload = (await response.json()) as {
      status?: { message?: unknown; state?: unknown };
    };
    return {
      message: typeof payload.status?.message === 'string' ? payload.status.message : undefined,
      state: typeof payload.status?.state === 'string' ? payload.status.state : undefined,
    };
  }

  async getExecdEndpoint(id: string, signal: AbortSignal): Promise<ExecdEndpoint> {
    const response = await fetch(
      `${this.baseUrl}/v1/sandboxes/${encodeURIComponent(id)}/endpoints/${EXECD_PORT}?use_server_proxy=true`,
      { headers: this.headers(), signal },
    );
    await ensureOk(response, 'OpenSandbox could not resolve the sandbox endpoint');
    const payload = (await response.json()) as { endpoint?: unknown; headers?: unknown };
    if (typeof payload.endpoint !== 'string' || !payload.endpoint) {
      throw new OpenSandboxHttpError(response.status, 'OpenSandbox returned no sandbox endpoint.');
    }
    const endpoint = payload.endpoint.replace(/\/+$/, '');
    const headers: Record<string, string> = {};
    if (payload.headers && typeof payload.headers === 'object') {
      for (const [key, value] of Object.entries(payload.headers)) {
        if (typeof value === 'string') headers[key] = value;
      }
    }
    return {
      headers,
      url: /^https?:\/\//i.test(endpoint) ? endpoint : `${this.protocol}//${endpoint}`,
    };
  }

  /**
   * Running sandboxes whose metadata matches every pair. The Docker runtime
   * stores metadata as container labels, so this survives ChatHub restarts and
   * is shared by every ChatHub process.
   */
  async findRunningSandboxes(metadata: Record<string, string>, signal: AbortSignal) {
    const filter = Object.entries(metadata)
      .map(([key, value]) => `${key}=${value}`)
      .join('&');
    const query = new URLSearchParams({ metadata: filter, state: 'Running' });
    const response = await fetch(`${this.baseUrl}/v1/sandboxes?${query}`, {
      headers: this.headers(),
      signal,
    });
    await ensureOk(response, 'OpenSandbox could not list sandboxes');
    const payload = (await response.json()) as { items?: unknown };
    if (!Array.isArray(payload.items)) return [];
    return payload.items.flatMap((item) => {
      const { createdAt, id, metadata } = (item ?? {}) as {
        createdAt?: unknown;
        id?: unknown;
        metadata?: unknown;
      };
      if (typeof id !== 'string' || !id) return [];
      const labels: Record<string, string> = {};
      if (metadata && typeof metadata === 'object') {
        for (const [key, value] of Object.entries(metadata)) {
          if (typeof value === 'string') labels[key] = value;
        }
      }
      return [{ createdAt: parseTimestamp(createdAt), id, metadata: labels }];
    });
  }

  /** Sets an absolute expiry; unlike create, the server's max timeout does not cap it. */
  async renewExpiration(id: string, expiresAt: Date, signal: AbortSignal) {
    const response = await fetch(
      `${this.baseUrl}/v1/sandboxes/${encodeURIComponent(id)}/renew-expiration`,
      {
        body: JSON.stringify({ expiresAt: expiresAt.toISOString() }),
        headers: this.headers({ 'Content-Type': 'application/json' }),
        method: 'POST',
        signal,
      },
    );
    await ensureOk(response, 'OpenSandbox could not renew the sandbox');
  }

  async deleteSandbox(id: string, signal: AbortSignal) {
    const response = await fetch(`${this.baseUrl}/v1/sandboxes/${encodeURIComponent(id)}`, {
      headers: this.headers(),
      method: 'DELETE',
      signal,
    });
    if (response.status === 404) return;
    await ensureOk(response, 'OpenSandbox could not delete the sandbox');
  }

  /**
   * A sandbox reports `Running` once its container starts, before execd
   * listens; the proxy answers 502 until then.
   */
  async pingExecd(execd: ExecdEndpoint, signal: AbortSignal) {
    const response = await fetch(`${execd.url}/ping`, {
      headers: this.headers(execd.headers),
      signal,
    });
    await response.body?.cancel();
    return response.ok;
  }

  /**
   * Shell command over SSE; execd runs it with `bash -c`. The first event is
   * `init`, whose `text` is the command id. execd enforces `timeoutMs` itself
   * (SIGKILL, reported as an `error` event with `evalue` "-1"); a non-zero
   * exit is an `error` event with the exit code as `evalue`, success is
   * `execution_complete`. stdout/stderr arrive one event per line, newline
   * stripped. A background command sends `init` and `execution_complete` as
   * soon as it starts; its output is read with `getCommandLogs`.
   */
  async *runCommand(
    execd: ExecdEndpoint,
    {
      background,
      command,
      cwd,
      timeoutMs,
    }: { background?: boolean; command: string; cwd: string; timeoutMs?: number },
    signal: AbortSignal,
  ): AsyncGenerator<OpenSandboxStreamEvent> {
    const response = await fetch(`${execd.url}/command`, {
      body: JSON.stringify({
        ...(background ? { background: true } : {}),
        command,
        cwd,
        ...(timeoutMs ? { timeout: timeoutMs } : {}),
      }),
      headers: this.headers({
        ...execd.headers,
        'Accept': 'text/event-stream',
        'Content-Type': 'application/json',
      }),
      method: 'POST',
      signal,
    });
    await ensureOk(response, 'OpenSandbox could not run the command');
    yield* parseEventStream(response);
  }

  async getCommandStatus(execd: ExecdEndpoint, id: string, signal: AbortSignal) {
    const response = await fetch(`${execd.url}/command/status/${encodeURIComponent(id)}`, {
      headers: this.headers(execd.headers),
      signal,
    });
    await ensureOk(response, 'OpenSandbox could not read the command status');
    const payload = (await response.json()) as {
      error?: unknown;
      exit_code?: unknown;
      running?: unknown;
    };
    return {
      error: typeof payload.error === 'string' && payload.error ? payload.error : undefined,
      exitCode: typeof payload.exit_code === 'number' ? payload.exit_code : undefined,
      running: payload.running === true,
    };
  }

  /**
   * Combined stdout/stderr of a background command from byte offset
   * `cursor`. The body is plain text; the next offset comes back in the
   * `EXECD-COMMANDS-TAIL-CURSOR` header. `onChunk` receives the decoded body
   * as it arrives so the caller can keep a bounded view of a large log.
   */
  async getCommandLogs(
    execd: ExecdEndpoint,
    id: string,
    cursor: number | undefined,
    signal: AbortSignal,
    onChunk: (text: string) => void,
  ) {
    const query = cursor === undefined ? '' : `?cursor=${Math.max(0, Math.floor(cursor))}`;
    const response = await fetch(`${execd.url}/command/${encodeURIComponent(id)}/logs${query}`, {
      headers: this.headers(execd.headers),
      signal,
    });
    await ensureOk(response, 'OpenSandbox could not read the command output');
    const rawCursor = Number(response.headers.get('execd-commands-tail-cursor'));
    const decoder = new TextDecoder('utf8');
    if (response.body) {
      const reader = response.body.getReader();
      try {
        let next = await reader.read();
        while (!next.done) {
          if (next.value?.byteLength) onChunk(decoder.decode(next.value, { stream: true }));
          next = await reader.read();
        }
      } finally {
        await reader.cancel().catch(() => undefined);
      }
    }
    onChunk(decoder.decode());
    return { cursor: Number.isFinite(rawCursor) && rawCursor >= 0 ? rawCursor : undefined };
  }

  /** Stops a running command and its process group. */
  async interruptCommand(execd: ExecdEndpoint, id: string, signal: AbortSignal) {
    const response = await fetch(`${execd.url}/command?id=${encodeURIComponent(id)}`, {
      headers: this.headers(execd.headers),
      method: 'DELETE',
      signal,
    });
    await response.body?.cancel();
    if (!response.ok) {
      throw new OpenSandboxHttpError(
        response.status,
        `OpenSandbox could not stop the command (HTTP ${response.status})`,
      );
    }
  }

  /** Metadata for one path, or undefined when it does not exist. */
  async getFileInfo(execd: ExecdEndpoint, path: string, signal: AbortSignal) {
    const response = await fetch(`${execd.url}/files/info?path=${encodeURIComponent(path)}`, {
      headers: this.headers(execd.headers),
      signal,
    });
    if (response.status === 404) {
      await response.body?.cancel();
      return undefined;
    }
    await ensureOk(response, 'OpenSandbox could not read file metadata');
    const payload = (await response.json()) as Record<string, unknown>;
    return toFileInfo(payload?.[path] ?? Object.values(payload ?? {})[0]);
  }

  /** Entries under `path` up to `depth` levels, in execd's lexical order. */
  async listDirectory(execd: ExecdEndpoint, path: string, depth: number, signal: AbortSignal) {
    const query = new URLSearchParams({ depth: String(depth), path });
    const response = await fetch(`${execd.url}/directories/list?${query}`, {
      headers: this.headers(execd.headers),
      signal,
    });
    await ensureOk(response, 'OpenSandbox could not list the directory');
    const body = await readCappedBody(response, OPENSANDBOX_LISTING_MAX_BYTES);
    const parsed = JSON.parse(Buffer.from(body).toString('utf8')) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((item) => {
      const info = toFileInfo(item);
      return info ? [info] : [];
    });
  }

  async uploadFiles(
    execd: ExecdEndpoint,
    files: Array<{ content: Uint8Array; mode?: number; path: string }>,
    signal: AbortSignal,
  ) {
    if (files.length === 0) return;
    // Each file is a `metadata` JSON part followed by its `file` part. execd
    // creates missing parent directories and applies `mode`.
    const form = new FormData();
    for (const file of files) {
      form.append(
        'metadata',
        new Blob([JSON.stringify({ mode: file.mode ?? 666, path: file.path })], {
          type: 'application/json',
        }),
        'metadata',
      );
      form.append(
        'file',
        new Blob([new Uint8Array(file.content)], { type: 'application/octet-stream' }),
        file.path.split('/').pop() || 'file',
      );
    }
    const response = await fetch(`${execd.url}/files/upload`, {
      body: form,
      headers: this.headers(execd.headers),
      method: 'POST',
      signal,
    });
    await ensureOk(response, 'OpenSandbox could not upload files');
  }

  async downloadFile(execd: ExecdEndpoint, path: string, signal: AbortSignal, maxBytes: number) {
    const response = await fetch(
      `${execd.url}/files/download?path=${encodeURIComponent(path)}`,
      { headers: this.headers(execd.headers), signal },
    );
    await ensureOk(response, 'OpenSandbox could not download a file');
    return readCappedBody(response, maxBytes);
  }
}
