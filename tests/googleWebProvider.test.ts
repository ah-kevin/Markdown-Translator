import { describe, expect, it, vi } from 'vitest';
import {
  GoogleWebProvider,
  TranslationProviderError,
  parseGtxTranslation,
  parseMobileTranslation,
  parseRpcTranslation
} from '../src/translation/googleWebProvider';

describe('Google Web provider parsing', () => {
  it('extracts and decodes the translated text from the mobile result container', () => {
    const html = '<html><body><div class="result-container">长夜将至 &amp; 守望开始</div></body></html>';

    expect(parseMobileTranslation(html)).toBe('长夜将至 & 守望开始');
  });

  it('extracts the translated text from a batchexecute response', () => {
    const inner = JSON.stringify([[['长夜将至', 'Night gathers', null, null, 3]], null, 'en']);
    const outer = JSON.stringify([['wrb.fr', 'MkEWBc', inner, null, null, null, 'generic']]);
    const response = `)]}'\n\n${outer}\n`;

    expect(parseRpcTranslation(response)).toBe('长夜将至');
  });

  it('joins the translated segments from a translate_a/single response', () => {
    const response = JSON.stringify([
      [
        ['长夜将至', 'Night gathers', null, null, 3],
        ['，守望开始', ', my watch begins', null, null, 3]
      ],
      null,
      'en'
    ]);

    expect(parseGtxTranslation(response)).toBe('长夜将至，守望开始');
  });
});

describe('GoogleWebProvider', () => {
  it('translates a single request text with the mobile candidate', async () => {
    const fetchMock = vi.fn(async () => new Response(
      '<div class="result-container">长夜将至</div>',
      { status: 200 }
    ));
    const provider = new GoogleWebProvider({ fetch: fetchMock, candidate: 'mobile' });

    const results = await provider.translate({
      sourceLanguage: 'en',
      targetLanguage: 'zh-CN',
      texts: [{ id: 'p1', text: 'Night gathers' }]
    });

    expect(results).toEqual([{ id: 'p1', translatedText: '长夜将至' }]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('passes cancellation signals to mobile fetch requests', async () => {
    const abortController = new AbortController();
    const fetchMock = vi.fn(async (input: string | URL, init?: RequestInit) => {
      expect(init?.signal).toBe(abortController.signal);
      return new Response(
        '<div class="result-container">长夜将至</div>',
        { status: 200 }
      );
    });
    const provider = new GoogleWebProvider({ fetch: fetchMock, candidate: 'mobile' });

    await provider.translate({
      abortSignal: abortController.signal,
      sourceLanguage: 'en',
      targetLanguage: 'zh-CN',
      texts: [{ id: 'p1', text: 'Night gathers' }]
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('batches multiple mobile translations into one request and splits the result by marker', async () => {
    const fetchMock = vi.fn(async () => new Response(
      '<div class="result-container">长夜将至\n&lt;&lt;&lt;MD_TRANSLATOR_BLOCK_0&gt;&gt;&gt;\n守望开始</div>',
      { status: 200 }
    ));
    const provider = new GoogleWebProvider({ fetch: fetchMock, candidate: 'mobile' });

    const results = await provider.translate({
      sourceLanguage: 'en',
      targetLanguage: 'zh-CN',
      texts: [
        { id: 'p1', text: 'Night gathers' },
        { id: 'p2', text: 'My watch begins' }
      ]
    });

    expect(results).toEqual([
      { id: 'p1', translatedText: '长夜将至' },
      { id: 'p2', translatedText: '守望开始' }
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const url = fetchMock.mock.calls[0][0] as URL;
    expect(url.searchParams.get('q')).toBe('Night gathers\n<<<MD_TRANSLATOR_BLOCK_0>>>\nMy watch begins');
  });

  it('falls back to per-text mobile requests when a batch result cannot be split', async () => {
    const fetchMock = vi.fn(async (input: string | URL) => {
      const url = input instanceof URL ? input : new URL(input);
      const text = url.searchParams.get('q');
      if (text?.includes('<<<MD_TRANSLATOR_BLOCK_0>>>')) {
        return new Response('<div class="result-container">长夜将至守望开始</div>', { status: 200 });
      }
      return new Response(
        `<div class="result-container">${text === 'Night gathers' ? '长夜将至' : '守望开始'}</div>`,
        { status: 200 }
      );
    });
    const provider = new GoogleWebProvider({ fetch: fetchMock, candidate: 'mobile' });

    const results = await provider.translate({
      sourceLanguage: 'en',
      targetLanguage: 'zh-CN',
      texts: [
        { id: 'p1', text: 'Night gathers' },
        { id: 'p2', text: 'My watch begins' }
      ]
    });

    expect(results).toEqual([
      { id: 'p1', translatedText: '长夜将至' },
      { id: 'p2', translatedText: '守望开始' }
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('classifies 429 responses as rate limit errors', async () => {
    const fetchMock = vi.fn(async () => new Response('too many requests', { status: 429 }));
    const provider = new GoogleWebProvider({ fetch: fetchMock, candidate: 'mobile' });

    await expect(provider.translate({
      sourceLanguage: 'en',
      targetLanguage: 'zh-CN',
      texts: [{ id: 'p1', text: 'Night gathers' }]
    })).rejects.toMatchObject({
      code: 'RATE_LIMIT',
      candidate: 'mobile'
    } satisfies Partial<TranslationProviderError>);
  });
});

describe('GoogleWebProvider gtx candidate', () => {
  const nidCookie = 'NID=abc123; expires=Tue, 16-Mar-2027 08:27:59 GMT; path=/; domain=.google.com; Secure; HttpOnly';

  function createGtxFetchMock(translate: (text: string) => Response) {
    return vi.fn(async (input: string | URL, init?: RequestInit) => {
      const url = input instanceof URL ? input : new URL(input);
      if (url.pathname === '/') {
        return new Response('', { status: 200, headers: { 'Set-Cookie': nidCookie } });
      }
      return translate(new URLSearchParams(String(init?.body)).get('q') ?? '');
    });
  }

  function gtxResponse(translatedText: string): Response {
    return new Response(JSON.stringify([[[translatedText, 'source', null, null, 3]], null, 'en']), { status: 200 });
  }

  it('fetches a Google cookie before posting the text to translate_a/single', async () => {
    const fetchMock = createGtxFetchMock(() => gtxResponse('长夜将至'));
    const provider = new GoogleWebProvider({ fetch: fetchMock, candidate: 'gtx' });

    const results = await provider.translate({
      sourceLanguage: 'en',
      targetLanguage: 'zh-CN',
      texts: [{ id: 'p1', text: 'Night gathers' }]
    });

    expect(results).toEqual([{ id: 'p1', translatedText: '长夜将至' }]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [translateInput, translateInit] = fetchMock.mock.calls[1];
    const translateUrl = translateInput as URL;
    expect(translateUrl.pathname).toBe('/translate_a/single');
    expect(translateUrl.searchParams.get('client')).toBe('gtx');
    expect(translateUrl.searchParams.get('sl')).toBe('en');
    expect(translateUrl.searchParams.get('tl')).toBe('zh-CN');
    expect(translateInit?.method).toBe('POST');
    expect(new Headers(translateInit?.headers).get('Cookie')).toBe('NID=abc123');
    expect(new URLSearchParams(String(translateInit?.body)).get('q')).toBe('Night gathers');
  });

  it('batches multiple gtx translations into one request and splits the result by marker', async () => {
    const fetchMock = createGtxFetchMock(() => gtxResponse('长夜将至\n<<<MD_TRANSLATOR_BLOCK_0>>>\n守望开始'));
    const provider = new GoogleWebProvider({ fetch: fetchMock, candidate: 'gtx' });

    const results = await provider.translate({
      sourceLanguage: 'en',
      targetLanguage: 'zh-CN',
      texts: [
        { id: 'p1', text: 'Night gathers' },
        { id: 'p2', text: 'My watch begins' }
      ]
    });

    expect(results).toEqual([
      { id: 'p1', translatedText: '长夜将至' },
      { id: 'p2', translatedText: '守望开始' }
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(new URLSearchParams(String(fetchMock.mock.calls[1][1]?.body)).get('q'))
      .toBe('Night gathers\n<<<MD_TRANSLATOR_BLOCK_0>>>\nMy watch begins');
  });

  it('reuses the Google cookie across gtx batch requests', async () => {
    const fetchMock = createGtxFetchMock((text) => gtxResponse(text === 'Night gathers' ? '长夜将至' : '守望开始'));
    const provider = new GoogleWebProvider({ fetch: fetchMock, candidate: 'gtx', maxBatchCharacters: 20 });

    const results = await provider.translate({
      sourceLanguage: 'en',
      targetLanguage: 'zh-CN',
      texts: [
        { id: 'p1', text: 'Night gathers' },
        { id: 'p2', text: 'My watch begins' }
      ]
    });

    expect(results).toEqual([
      { id: 'p1', translatedText: '长夜将至' },
      { id: 'p2', translatedText: '守望开始' }
    ]);
    const cookieRequests = fetchMock.mock.calls.filter(([input]) => (input as URL).pathname === '/');
    expect(cookieRequests).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('classifies gtx 429 responses as rate limit errors', async () => {
    const fetchMock = createGtxFetchMock(() => new Response('too many requests', { status: 429 }));
    const provider = new GoogleWebProvider({ fetch: fetchMock, candidate: 'gtx' });

    await expect(provider.translate({
      sourceLanguage: 'en',
      targetLanguage: 'zh-CN',
      texts: [{ id: 'p1', text: 'Night gathers' }]
    })).rejects.toMatchObject({
      code: 'RATE_LIMIT',
      candidate: 'gtx'
    } satisfies Partial<TranslationProviderError>);
  });
});
