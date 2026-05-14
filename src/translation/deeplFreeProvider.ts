import { TranslateRequest, TranslateResult, TranslateText } from './types';
import { TranslationProviderError } from './googleWebProvider';

type DeepLFreeProviderOptions = {
  baseUrl?: string;
  fetch?: (input: string | URL, init?: RequestInit) => Promise<Response>;
  log?: (message: string) => void;
  maxBatchCharacters?: number;
  onBatchComplete?: (results: TranslateResult[], completed: number, total: number) => Promise<void> | void;
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
const defaultMaxBatchCharacters = 4500;

export class DeepLFreeProvider {
  private readonly baseUrl: string;
  private readonly fetchImpl: (input: string | URL, init?: RequestInit) => Promise<Response>;
  private readonly log?: (message: string) => void;
  private readonly maxBatchCharacters: number;
  private readonly onBatchComplete?: (results: TranslateResult[], completed: number, total: number) => Promise<void> | void;

  constructor(options: DeepLFreeProviderOptions = {}) {
    this.baseUrl = options.baseUrl ?? defaultBaseUrl;
    this.fetchImpl = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.log = options.log;
    this.maxBatchCharacters = options.maxBatchCharacters ?? defaultMaxBatchCharacters;
    this.onBatchComplete = options.onBatchComplete;
  }

  async translate(request: TranslateRequest): Promise<TranslateResult[]> {
    const batches = createBatches(request.texts, this.maxBatchCharacters);
    this.log?.(`DeepL free batch plan: ${request.texts.length} texts -> ${batches.length} request(s)`);

    const results: TranslateResult[] = [];
    let completed = 0;
    for (const batch of batches) {
      const batchResults = await this.translateBatch(batch, request);
      results.push(...batchResults);
      completed += batch.length;
      await this.onBatchComplete?.(batchResults, completed, request.texts.length);
    }

    return results;
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
    this.log?.(`DeepL free batch request: ${texts.length} texts, ${JSON.stringify(texts.map((item) => item.text)).length} chars`);

    const responseBody = await this.fetchText(body);
    const translatedTexts = parseDeepLFreeTranslation(responseBody);
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
  const payload = {
    jsonrpc: '2.0',
    method: 'LMT_handle_texts',
    params: {
      splitting: 'newlines',
      lang: {
        source_lang_user_selected: normalizeSourceLanguage(options.sourceLanguage),
        target_lang: normalizeTargetLanguage(options.targetLanguage)
      },
      texts: options.texts.map((text) => ({
        text,
        requestAlternatives: 0
      })),
      timestamp: createTimestamp(options.texts),
      commonJobParams: {
        mode: 'translate'
      }
    },
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

function createBatches(texts: TranslateText[], maxBatchCharacters: number): TranslateText[][] {
  const batches: TranslateText[][] = [];
  let currentBatch: TranslateText[] = [];
  let currentLength = 0;

  for (const item of texts) {
    const nextLength = currentLength + item.text.length;
    if (currentBatch.length > 0 && nextLength > maxBatchCharacters) {
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
  return Math.floor(Math.random() * 99999) + 100000;
}

function createTimestamp(texts: string[]): number {
  const now = Date.now();
  const iCount = texts.join('').split('i').length - 1;
  return iCount === 0 ? now : now + (iCount - (now % iCount));
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
    return 'ZH';
  }
  if (normalized === 'ZH-TW' || normalized === 'ZH-HANT') {
    return 'ZH-HANT';
  }
  if (normalized === 'EN') {
    return 'EN-US';
  }
  return normalized;
}
