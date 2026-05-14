import { TranslateRequest, TranslateResult, TranslateText } from './types';
import { TranslationProviderError } from './googleWebProvider';

type DeepLFreeProviderOptions = {
  baseUrl?: string;
  fetch?: (input: string | URL, init?: RequestInit) => Promise<Response>;
  log?: (message: string) => void;
  maxBatchCharacters?: number;
  maxBatchTexts?: number;
  onBatchComplete?: (results: TranslateResult[], completed: number, total: number) => Promise<void> | void;
  retryDelayMs?: number;
  maxRetries?: number;
  requestDelayMs?: number;
};

type DeepLTextResult = {
  text?: string;
};

type DeepLResponse = {
  result?: {
    texts?: DeepLTextResult[];
  };
};

const defaultBaseUrl = 'https://www2.deepl.com/jsonrpc';
const defaultMaxBatchCharacters = 400;
const defaultMaxBatchTexts = 2;
const defaultRetryDelayMs = 10000;
const defaultMaxRetries = 2;
const defaultRequestDelayMs = 5000;

export class DeepLFreeProvider {
  private readonly baseUrl: string;
  private readonly fetchImpl: (input: string | URL, init?: RequestInit) => Promise<Response>;
  private readonly log?: (message: string) => void;
  private readonly maxBatchCharacters: number;
  private readonly maxBatchTexts: number;
  private readonly onBatchComplete?: (results: TranslateResult[], completed: number, total: number) => Promise<void> | void;
  private readonly retryDelayMs: number;
  private readonly maxRetries: number;
  private readonly requestDelayMs: number;

  constructor(options: DeepLFreeProviderOptions = {}) {
    this.baseUrl = options.baseUrl ?? defaultBaseUrl;
    this.fetchImpl = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.log = options.log;
    this.maxBatchCharacters = options.maxBatchCharacters ?? defaultMaxBatchCharacters;
    this.maxBatchTexts = options.maxBatchTexts ?? defaultMaxBatchTexts;
    this.onBatchComplete = options.onBatchComplete;
    this.retryDelayMs = options.retryDelayMs ?? defaultRetryDelayMs;
    this.maxRetries = options.maxRetries ?? defaultMaxRetries;
    this.requestDelayMs = options.requestDelayMs ?? defaultRequestDelayMs;
  }

  async translate(request: TranslateRequest): Promise<TranslateResult[]> {
    const batches = createBatches(request.texts, {
      maxBatchCharacters: this.maxBatchCharacters,
      maxBatchTexts: this.maxBatchTexts
    });
    this.log?.(`DeepL free batch plan: ${request.texts.length} texts -> ${batches.length} request(s)`);

    const results: TranslateResult[] = [];
    let completed = 0;
    for (const batch of batches) {
      const batchResults = await this.translateBatchWithFallback(batch, request);
      results.push(...batchResults);
      completed += batch.length;
      await this.onBatchComplete?.(batchResults, completed, request.texts.length);
      if (completed < request.texts.length && this.requestDelayMs > 0) {
        await sleep(this.requestDelayMs);
      }
    }

    return results;
  }

  private async translateBatchWithFallback(
    texts: TranslateText[],
    request: TranslateRequest
  ): Promise<TranslateResult[]> {
    if (texts.length === 1) {
      return this.translateSingleWithRetry(texts[0], request);
    }

    try {
      return await this.translateBatch(texts, request);
    } catch (error) {
      if (!isRateLimitError(error)) {
        throw error;
      }

      this.log?.(`DeepL free batch rate limited; waiting ${this.retryDelayMs}ms and splitting ${texts.length} texts`);
      await sleep(this.retryDelayMs);
      const splitAt = Math.ceil(texts.length / 2);
      const left = texts.slice(0, splitAt);
      const right = texts.slice(splitAt);
      return [
        ...await this.translateBatchWithFallback(left, request),
        ...await this.translateBatchWithFallback(right, request)
      ];
    }
  }

  private async translateSingleWithRetry(
    text: TranslateText,
    request: TranslateRequest
  ): Promise<TranslateResult[]> {
    for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
      try {
        return await this.translateBatch([text], request);
      } catch (error) {
        if (!isRateLimitError(error) || attempt >= this.maxRetries) {
          throw error;
        }

        const delayMs = this.retryDelayMs * (attempt + 1);
        this.log?.(`DeepL free per-text rate limited; retrying in ${delayMs}ms`);
        await sleep(delayMs);
      }
    }

    throw new TranslationProviderError('DeepL Free translation is rate limited.', {
      code: 'RATE_LIMIT',
      candidate: 'mobile'
    });
  }

  private async translateBatch(texts: TranslateText[], request: TranslateRequest): Promise<TranslateResult[]> {
    if (texts.length === 0) {
      return [];
    }

    const body = createDeepLRequestBody({
      texts: texts.map((item) => item.text),
      sourceLanguage: request.sourceLanguage,
      targetLanguage: request.targetLanguage
    });
    this.log?.(`DeepL free request: ${texts.length} text(s), ${JSON.stringify(texts.map((item) => item.text)).length} chars`);

    const responseBody = await this.fetchText(body);
    let translatedTexts: string[];
    try {
      translatedTexts = parseDeepLFreeTranslation(responseBody);
    } catch (error) {
      throw new TranslationProviderError('Failed to parse DeepL Free translation response.', {
        code: 'PARSE',
        candidate: 'mobile',
        cause: error
      });
    }
    if (translatedTexts.length !== texts.length) {
      throw new TranslationProviderError('DeepL Free response count does not match request count.', {
        code: 'PARSE',
        candidate: 'mobile'
      });
    }

    return texts.map((item, index) => ({
      id: item.id,
      translatedText: translatedTexts[index]
    }));
  }

  private async fetchText(body: string): Promise<string> {
    let response: Response;
    try {
      response = await this.fetchImpl(this.baseUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': '*/*',
          'User-Agent': 'Mozilla/5.0 Markdown-Translator'
        },
        body
      });
    } catch (error) {
      throw new TranslationProviderError('DeepL Free translation request failed.', {
        code: 'NETWORK',
        candidate: 'mobile',
        cause: error
      });
    }

    if (response.status === 429) {
      this.log?.('DeepL free response: 429');
      throw new TranslationProviderError('DeepL Free translation is rate limited.', {
        code: 'RATE_LIMIT',
        candidate: 'mobile',
        status: response.status
      });
    }

    if (!response.ok) {
      this.log?.(`DeepL free response: HTTP ${response.status}`);
      throw new TranslationProviderError(`DeepL Free translation returned HTTP ${response.status}.`, {
        code: 'HTTP',
        candidate: 'mobile',
        status: response.status
      });
    }

    this.log?.(`DeepL free response: HTTP ${response.status}`);
    return response.text();
  }
}

export function createDeepLRequestBody(options: {
  texts: string[];
  sourceLanguage: string;
  targetLanguage: string;
}): string {
  const id = createRequestId();
  const targetLanguage = normalizeTargetLanguage(options.targetLanguage);
  const params: {
    splitting: string;
    lang: {
      source_lang_user_selected: string;
      target_lang: string;
    };
    texts: Array<{
      text: string;
      requestAlternatives: number;
    }>;
    timestamp: number;
    commonJobParams?: {
      regionalVariant: string;
    };
  } = {
    splitting: 'newlines',
    lang: {
      source_lang_user_selected: normalizeSourceLanguage(options.sourceLanguage),
      target_lang: normalizeDeepLTargetLanguage(targetLanguage)
    },
    texts: options.texts.map((text) => ({
      text,
      requestAlternatives: 3
    })),
    timestamp: createTimestamp(options.texts)
  };
  if (targetLanguage === 'ZH-HANS' || targetLanguage === 'ZH-HANT') {
    params.commonJobParams = {
      regionalVariant: targetLanguage
    };
  }

  const payload = {
    jsonrpc: '2.0',
    method: 'LMT_handle_texts',
    params,
    id
  };

  const body = JSON.stringify(payload);
  return (id + 5) % 29 === 0
    ? body.replace('"method":"', '"method" : "')
    : body.replace('"method":"', '"method": "');
}

export function parseDeepLFreeTranslation(body: string): string[] {
  let payload: DeepLResponse;
  try {
    payload = JSON.parse(body) as DeepLResponse;
  } catch (error) {
    throw new Error('Invalid DeepL Free JSON response.', { cause: error });
  }

  const texts = payload.result?.texts;
  if (!texts || texts.length === 0) {
    throw new Error('Missing DeepL Free translation texts.');
  }

  return texts.map((item) => {
    if (!item.text) {
      throw new Error('Missing DeepL Free translated text.');
    }
    return item.text;
  });
}

function isRateLimitError(error: unknown): boolean {
  return error instanceof TranslationProviderError && error.code === 'RATE_LIMIT';
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createBatches(
  texts: TranslateText[],
  limits: { maxBatchCharacters: number; maxBatchTexts: number }
): TranslateText[][] {
  const batches: TranslateText[][] = [];
  let currentBatch: TranslateText[] = [];
  let currentLength = 0;

  for (const item of texts) {
    const nextLength = currentLength + item.text.length;
    const wouldExceedTexts = currentBatch.length >= limits.maxBatchTexts;
    const wouldExceedCharacters = currentBatch.length > 0 && nextLength > limits.maxBatchCharacters;
    if (wouldExceedTexts || wouldExceedCharacters) {
      batches.push(currentBatch);
      currentBatch = [];
      currentLength = 0;
    }

    currentBatch.push(item);
    currentLength += item.text.length;
  }

  if (currentBatch.length > 0) {
    batches.push(currentBatch);
  }

  return batches;
}

function createRequestId(): number {
  return (Math.floor(Math.random() * 99999) + 100000) * 1000;
}

function createTimestamp(texts: string[]): number {
  const now = Date.now();
  const iCount = texts.join('').split('i').length - 1;
  if (iCount === 0) {
    return now;
  }

  const interval = iCount + 1;
  return now - (now % interval) + interval;
}

function normalizeSourceLanguage(language: string): string {
  if (!language || language.toLowerCase() === 'auto') {
    return 'auto';
  }

  return normalizeTargetLanguage(language);
}

function normalizeTargetLanguage(language: string): string {
  const normalized = language.toUpperCase().replace('_', '-');
  if (normalized === 'ZH-CN' || normalized === 'ZH-HANS') {
    return 'ZH-HANS';
  }
  if (normalized === 'ZH-TW' || normalized === 'ZH-HANT') {
    return 'ZH-HANT';
  }
  if (normalized === 'EN') {
    return 'EN-US';
  }
  return normalized;
}

function normalizeDeepLTargetLanguage(language: string): string {
  return language === 'ZH-HANS' || language === 'ZH-HANT' ? 'ZH' : language;
}
