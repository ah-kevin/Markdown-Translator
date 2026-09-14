import { TranslateRequest, TranslateResult, TranslateText } from './types';

export type TranslationCandidate = 'mobile' | 'rpc' | 'gtx';


export type TranslationProviderErrorCode =
  | 'RATE_LIMIT'
  | 'NETWORK'
  | 'HTTP'
  | 'PARSE';

export class TranslationProviderError extends Error {
  readonly code: TranslationProviderErrorCode;
  readonly candidate: TranslationCandidate;
  readonly status?: number;

  constructor(message: string, options: {
    code: TranslationProviderErrorCode;
    candidate: TranslationCandidate;
    status?: number;
    cause?: unknown;
  }) {
    super(message);
    this.name = 'TranslationProviderError';
    this.code = options.code;
    this.candidate = options.candidate;
    this.status = options.status;
    this.cause = options.cause;
  }
}

export type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

type GoogleWebProviderOptions = {
  fetch?: FetchLike;
  candidate?: TranslationCandidate;
  baseUrl?: string;
  maxBatchCharacters?: number;
  log?: (message: string) => void;
  onBatchComplete?: (results: TranslateResult[], completed: number, total: number) => Promise<void> | void;
};

const batchMarkerPrefix = '<<<MD_TRANSLATOR_BLOCK_';
const batchMarkerSuffix = '>>>';
const defaultMaxBatchCharacters = 4500;

export class GoogleWebProvider {
  private readonly fetchImpl: FetchLike;
  private readonly candidate: TranslationCandidate;
  private readonly baseUrl: string;
  private readonly maxBatchCharacters: number;
  private readonly log?: (message: string) => void;
  private readonly onBatchComplete?: (results: TranslateResult[], completed: number, total: number) => Promise<void> | void;
  private cookie?: Promise<string>;

  constructor(options: GoogleWebProviderOptions = {}) {
    this.fetchImpl = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.candidate = options.candidate ?? 'mobile';
    this.baseUrl = options.baseUrl ?? 'https://translate.google.com';
    this.maxBatchCharacters = options.maxBatchCharacters ?? defaultMaxBatchCharacters;
    this.log = options.log;
    this.onBatchComplete = options.onBatchComplete;
  }

  async translate(request: TranslateRequest): Promise<TranslateResult[]> {
    throwIfAborted(request.abortSignal);
    if (this.candidate === 'mobile' || this.candidate === 'gtx') {
      return this.translateMobileBatches(request);
    }

    const results: TranslateResult[] = [];

    for (const item of request.texts) {
      throwIfAborted(request.abortSignal);
      const translatedText = await this.translateWithRpc(item.text, request);

      results.push({ id: item.id, translatedText });
    }

    return results;
  }

  private async translateMobileBatches(request: TranslateRequest): Promise<TranslateResult[]> {
    if (request.texts.length <= 1) {
      const item = request.texts[0];
      if (!item) {
        return [];
      }

      return [{ id: item.id, translatedText: await this.translateSingle(item.text, request) }];
    }

    const results: TranslateResult[] = [];
    const batches = createMobileBatches(request.texts, this.maxBatchCharacters);
    this.log?.(`Google ${this.candidate} batch plan: ${request.texts.length} texts -> ${batches.length} request(s)`);
    let completed = 0;

    for (const batch of batches) {
      throwIfAborted(request.abortSignal);
      const batchResults = await this.translateMobileBatch(batch, request);
      results.push(...batchResults);
      completed += batch.length;
      await this.onBatchComplete?.(batchResults, completed, request.texts.length);
    }
    return results;
  }

  private async translateMobileBatch(
    texts: TranslateText[],
    request: TranslateRequest
  ): Promise<TranslateResult[]> {
    if (texts.length === 1) {
      const item = texts[0];
      return [{ id: item.id, translatedText: await this.translateSingle(item.text, request) }];
    }

    const combinedText = combineBatchText(texts);
    this.log?.(`Google ${this.candidate} batch request: ${texts.length} texts, ${combinedText.length} chars`);
    const translatedText = await this.translateSingle(combinedText, request);
    const translatedParts = splitBatchTranslation(translatedText, texts.length);
    if (!translatedParts) {
      this.log?.(`Google ${this.candidate} batch split failed; falling back to ${texts.length} per-text request(s)`);
      return this.translateMobileItemsIndividually(texts, request);
    }

    return texts.map((item, index) => ({
      id: item.id,
      translatedText: translatedParts[index]
    }));
  }

  private async translateMobileItemsIndividually(
    texts: TranslateText[],
    request: TranslateRequest
  ): Promise<TranslateResult[]> {
    const results: TranslateResult[] = [];
    for (const item of texts) {
      throwIfAborted(request.abortSignal);
      this.log?.(`Google ${this.candidate} per-text request: ${item.text.length} chars`);
      results.push({
        id: item.id,
        translatedText: await this.translateSingle(item.text, request)
      });
    }
    return results;
  }

  private async translateWithMobile(text: string, request: TranslateRequest): Promise<string> {
    const url = new URL('/m', this.baseUrl);
    url.searchParams.set('sl', request.sourceLanguage);
    url.searchParams.set('tl', request.targetLanguage);
    url.searchParams.set('q', text);

    const body = await this.fetchText(url, 'mobile', {
      signal: request.abortSignal
    });
    try {
      return parseMobileTranslation(body);
    } catch (error) {
      throw new TranslationProviderError('Failed to parse Google mobile translation response.', {
        code: 'PARSE',
        candidate: 'mobile',
        cause: error
      });
    }
  }

  private translateSingle(text: string, request: TranslateRequest): Promise<string> {
    return this.candidate === 'gtx'
      ? this.translateWithGtx(text, request)
      : this.translateWithMobile(text, request);
  }

  private async translateWithGtx(text: string, request: TranslateRequest): Promise<string> {
    const url = new URL('/translate_a/single', this.baseUrl);
    url.searchParams.set('client', 'gtx');
    url.searchParams.set('sl', request.sourceLanguage);
    url.searchParams.set('tl', request.targetLanguage);
    url.searchParams.set('dt', 't');
    url.searchParams.set('ie', 'UTF-8');
    url.searchParams.set('oe', 'UTF-8');

    const cookie = await this.getCookie(request.abortSignal);
    const body = await this.fetchText(url, 'gtx', {
      method: 'POST',
      signal: request.abortSignal,
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
        ...(cookie ? { Cookie: cookie } : {})
      },
      body: new URLSearchParams({ q: text }).toString()
    });
    try {
      return parseGtxTranslation(body);
    } catch (error) {
      throw new TranslationProviderError('Failed to parse Google gtx translation response.', {
        code: 'PARSE',
        candidate: 'gtx',
        cause: error
      });
    }
  }

  // Google answers cookie-less translate_a/single requests with 429, so fetch the NID
  // cookie from the homepage once per provider and reuse it for every request.
  private getCookie(abortSignal: AbortSignal | undefined): Promise<string> {
    if (!this.cookie) {
      this.cookie = this.fetchCookie(abortSignal).catch((error: unknown) => {
        this.cookie = undefined;
        throw error;
      });
    }
    return this.cookie;
  }

  private async fetchCookie(abortSignal: AbortSignal | undefined): Promise<string> {
    let response: Response;
    try {
      response = await this.fetchImpl(new URL('/', this.baseUrl), { redirect: 'manual', signal: abortSignal });
    } catch (error) {
      if (isAbortError(error)) {
        throw createAbortError();
      }
      throw new TranslationProviderError('Google Web cookie request failed.', {
        code: 'NETWORK',
        candidate: 'gtx',
        cause: error
      });
    }

    const setCookies = typeof response.headers.getSetCookie === 'function'
      ? response.headers.getSetCookie()
      : [response.headers.get('set-cookie') ?? ''];
    const cookie = setCookies.map((value) => value.split(';')[0].trim()).filter(Boolean).join('; ');
    this.log?.(`Google gtx cookie response: HTTP ${response.status}, ${cookie ? 'cookie received' : 'no cookie'}`);
    return cookie;
  }

  private async translateWithRpc(text: string, request: TranslateRequest): Promise<string> {
    const url = new URL('/_/TranslateWebserverUi/data/batchexecute', this.baseUrl);
    url.searchParams.set('rpcids', 'MkEWBc');
    url.searchParams.set('source-path', '/');
    url.searchParams.set('f.sid', '');
    url.searchParams.set('bl', '');
    url.searchParams.set('hl', request.targetLanguage);
    url.searchParams.set('soc-app', '1');
    url.searchParams.set('soc-platform', '1');
    url.searchParams.set('soc-device', '1');
    url.searchParams.set('_reqid', '0');
    url.searchParams.set('rt', 'c');

    const rpcPayload = JSON.stringify([[
      [
        'MkEWBc',
        JSON.stringify([[text, request.sourceLanguage, request.targetLanguage, true], [null]]),
        null,
        'generic'
      ]
    ]]);

    const body = await this.fetchText(url, 'rpc', {
      method: 'POST',
      signal: request.abortSignal,
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
        'User-Agent': 'Mozilla/5.0 Markdown-Translator'
      },
      body: new URLSearchParams({ 'f.req': rpcPayload }).toString()
    });

    try {
      return parseRpcTranslation(body);
    } catch (error) {
      throw new TranslationProviderError('Failed to parse Google RPC translation response.', {
        code: 'PARSE',
        candidate: 'rpc',
        cause: error
      });
    }
  }

  private async fetchText(
    url: URL,
    candidate: TranslationCandidate,
    init?: RequestInit
  ): Promise<string> {
    let response: Response;
    try {
      response = await this.fetchImpl(url, init);
    } catch (error) {
      if (isAbortError(error)) {
        throw createAbortError();
      }
      throw new TranslationProviderError('Google Web translation request failed.', {
        code: 'NETWORK',
        candidate,
        cause: error
      });
    }

    if (response.status === 429) {
      this.log?.(`Google ${candidate} response: 429`);
      throw new TranslationProviderError('Google Web translation is rate limited.', {
        code: 'RATE_LIMIT',
        candidate,
        status: response.status
      });
    }

    if (!response.ok) {
      this.log?.(`Google ${candidate} response: HTTP ${response.status}`);
      throw new TranslationProviderError(`Google Web translation returned HTTP ${response.status}.`, {
        code: 'HTTP',
        candidate,
        status: response.status
      });
    }

    this.log?.(`Google ${candidate} response: HTTP ${response.status}`);
    return response.text();
  }
}

export function parseMobileTranslation(html: string): string {
  const match = /<div[^>]*class=["'][^"']*\bresult-container\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/i.exec(html);
  if (!match) {
    throw new Error('Missing result-container.');
  }

  return decodeHtml(stripHtml(match[1]).trim());
}

export function parseGtxTranslation(text: string): string {
  const payload: unknown = JSON.parse(text);
  const segments = Array.isArray(payload) ? payload[0] : undefined;
  if (!Array.isArray(segments)) {
    throw new Error('Missing translation segments.');
  }

  const translatedText = segments
    .map((segment: unknown) => (Array.isArray(segment) && typeof segment[0] === 'string' ? segment[0] : ''))
    .join('');
  if (!translatedText) {
    throw new Error('Missing translated text.');
  }

  return translatedText;
}

export function parseRpcTranslation(text: string): string {
  const jsonStart = text.indexOf('[');
  if (jsonStart === -1) {
    throw new Error('Missing JSON payload.');
  }

  const payload = JSON.parse(text.slice(jsonStart));
  const translatedText = findRpcTranslatedText(payload);
  if (!translatedText) {
    throw new Error('Missing translated text.');
  }

  return translatedText;
}

function findRpcTranslatedText(value: unknown): string | undefined {
  if (Array.isArray(value)) {
    if (
      typeof value[0] === 'string'
      && typeof value[1] === 'string'
      && typeof value[2] !== 'string'
    ) {
      return value[0];
    }

    for (const item of value) {
      const translatedText = findRpcTranslatedText(item);
      if (translatedText) {
        return translatedText;
      }
    }
    return undefined;
  }

  if (typeof value === 'string' && value.trim().startsWith('[')) {
    try {
      return findRpcTranslatedText(JSON.parse(value));
    } catch {
      return undefined;
    }
  }

  return undefined;
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, '');
}

function decodeHtml(value: string): string {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function createMobileBatches(texts: TranslateText[], maxBatchCharacters: number): TranslateText[][] {
  const batches: TranslateText[][] = [];
  let currentBatch: TranslateText[] = [];
  let currentLength = 0;

  for (const item of texts) {
    const markerLength = currentBatch.length > 0 ? getBatchMarker(currentBatch.length - 1).length + 2 : 0;
    const nextLength = currentLength + markerLength + item.text.length;
    if (currentBatch.length > 0 && nextLength > maxBatchCharacters) {
      batches.push(currentBatch);
      currentBatch = [];
      currentLength = 0;
    }

    const nextMarkerLength = currentBatch.length > 0 ? getBatchMarker(currentBatch.length - 1).length + 2 : 0;
    currentBatch.push(item);
    currentLength += nextMarkerLength + item.text.length;
  }

  if (currentBatch.length > 0) {
    batches.push(currentBatch);
  }

  return batches;
}

function combineBatchText(texts: TranslateText[]): string {
  return texts
    .map((item, index) => index === 0 ? item.text : `${getBatchMarker(index - 1)}\n${item.text}`)
    .join('\n');
}

function splitBatchTranslation(translatedText: string, expectedParts: number): string[] | undefined {
  const parts = translatedText
    .split(new RegExp(`\\s*${escapeRegExp(batchMarkerPrefix)}\\d+${escapeRegExp(batchMarkerSuffix)}\\s*`))
    .map((part) => part.trim());

  return parts.length === expectedParts && parts.every(Boolean) ? parts : undefined;
}

function getBatchMarker(index: number): string {
  return `${batchMarkerPrefix}${index}${batchMarkerSuffix}`;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function throwIfAborted(abortSignal: AbortSignal | undefined): void {
  if (abortSignal?.aborted) {
    throw createAbortError();
  }
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

function createAbortError(): Error {
  return new Error('Translation cancelled.');
}
