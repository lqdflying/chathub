import { knowledgeEnv } from '@/envs/knowledge';

export type MarkItDownErrorCode =
  | 'NotConfigured'
  | 'FileTooLarge'
  | 'UnsupportedFormat'
  | 'ConversionFailed'
  | 'ServiceUnavailable'
  | 'EmptyResult';

export class MarkItDownError extends Error {
  readonly code: MarkItDownErrorCode;

  constructor(code: MarkItDownErrorCode, message: string) {
    super(message);
    this.code = code;
    this.name = 'MarkItDownError';
  }
}

export interface MarkItDownConvertParams {
  content: Uint8Array;
  fileType?: string;
  filename: string;
}

export interface MarkItDownResult {
  /** The converted document, as Markdown. */
  markdown: string;
  /** Document title, when the source format carries one. */
  title?: string;
}

/** True when a MarkItDown sidecar is configured for this deployment. */
export const isMarkItDownEnabled = () => !!knowledgeEnv.MARKITDOWN_SERVICE_URL;

/**
 * Client for the MarkItDown conversion sidecar (see `docker/markitdown`).
 *
 * MarkItDown is a Python library, and the ChatHub runtime image is distroless
 * (node only), so conversion runs out of process behind a small HTTP API.
 */
export class MarkItDown {
  private baseUrl?: string;
  private apiKey?: string;
  private timeout: number;
  private maxFileSize: number;

  constructor(baseUrl?: string, apiKey?: string) {
    this.baseUrl = (baseUrl ?? knowledgeEnv.MARKITDOWN_SERVICE_URL)?.replace(/\/+$/, '');
    this.apiKey = apiKey ?? knowledgeEnv.MARKITDOWN_API_KEY;
    this.timeout = knowledgeEnv.MARKITDOWN_TIMEOUT;
    this.maxFileSize = knowledgeEnv.MARKITDOWN_MAX_FILE_SIZE;
  }

  async convert({
    content,
    filename,
    fileType,
  }: MarkItDownConvertParams): Promise<MarkItDownResult> {
    if (!this.baseUrl) {
      throw new MarkItDownError('NotConfigured', 'MARKITDOWN_SERVICE_URL is not set');
    }

    if (content.byteLength > this.maxFileSize) {
      throw new MarkItDownError(
        'FileTooLarge',
        `${filename} is ${content.byteLength} bytes, above the MARKITDOWN_MAX_FILE_SIZE limit of ${this.maxFileSize}`,
      );
    }

    const form = new FormData();
    // Copy into a standalone buffer: `content` may be a view onto a larger
    // ArrayBuffer, and Blob would otherwise capture the whole backing store.
    form.append('file', new Blob([content.slice()]), filename);
    form.append('filename', filename);
    if (fileType) form.append('mime_type', fileType);

    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/convert`, {
        body: form,
        headers: this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : undefined,
        method: 'POST',
        signal: AbortSignal.timeout(this.timeout),
      });
    } catch (error) {
      const reason = (error as Error)?.name === 'TimeoutError' ? 'timed out' : 'is unreachable';
      throw new MarkItDownError(
        'ServiceUnavailable',
        `MarkItDown service at ${this.baseUrl} ${reason}: ${(error as Error)?.message}`,
      );
    }

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new MarkItDownError(
        response.status === 415 ? 'UnsupportedFormat' : 'ConversionFailed',
        `MarkItDown failed to convert ${filename} (HTTP ${response.status}): ${detail.slice(0, 500)}`,
      );
    }

    const payload = (await response.json()) as { markdown?: string; title?: string };

    const markdown = payload.markdown?.trim();

    if (!markdown) {
      throw new MarkItDownError(
        'EmptyResult',
        `MarkItDown returned no content for ${filename}. The document may be empty, or a scanned image needing OCR.`,
      );
    }

    return { markdown, title: payload.title };
  }
}
