import { describe, expect, it, vi } from 'vitest';
import {
  DeepLFreeProvider,
  createDeepLRequestBody,
  parseDeepLFreeTranslation,
  shouldUseSpacedDeepLMethod
} from '../src/translation/deeplFreeProvider';
import { TranslationProviderError } from '../src/translation/googleWebProvider';

describe('DeepL Free provider request helpers', () => {
  it('creates a DeepL JSON-RPC request with normalized language codes', () => {
    const body = createDeepLRequestBody({
      texts: ['Night gathers'],
      sourceLanguage: 'auto',
      targetLanguage: 'zh-CN'
    });
    const normalized = body.replace('"method" : "', '"method":"').replace('"method": "', '"method":"');
    const payload = JSON.parse(normalized);

    expect(payload.method).toBe('LMT_handle_texts');
    expect(payload.params.lang).toEqual({
      source_lang_user_selected: 'auto',
      target_lang: 'ZH'
    });
    expect(payload.params.commonJobParams).toEqual({
      regionalVariant: 'ZH-HANS'
    });
    expect(payload.params.texts).toEqual([
      { text: 'Night gathers', requestAlternatives: 3 }
    ]);
  });

  it('matches DeepL web method spacing rules from the reference script', () => {
    expect(shouldUseSpacedDeepLMethod(100002000)).toBe(true);
    expect(shouldUseSpacedDeepLMethod(100012000)).toBe(true);
    expect(shouldUseSpacedDeepLMethod(100000000)).toBe(false);

    expect(createDeepLRequestBody({
      texts: ['Night gathers'],
      sourceLanguage: 'auto',
      targetLanguage: 'zh-CN',
      requestId: 100012000
    })).toContain('"method" : "LMT_handle_texts"');
    expect(createDeepLRequestBody({
      texts: ['Night gathers'],
      sourceLanguage: 'auto',
      targetLanguage: 'zh-CN',
      requestId: 100000000
    })).toContain('"method": "LMT_handle_texts"');
  });

  it('parses translated texts from a DeepL response', () => {
    const body = JSON.stringify({
      result: {
        texts: [
          { text: '夜幕降临' },
          { text: '守望开始' }
        ]
      }
    });

    expect(parseDeepLFreeTranslation(body)).toEqual(['夜幕降临', '守望开始']);
  });
});

describe('DeepLFreeProvider', () => {
  it('translates multiple texts and maps responses by id', async () => {
    const fetchMock = vi.fn(async (input: string | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body).replace('"method" : "', '"method":"').replace('"method": "', '"method":"'));
      return new Response(JSON.stringify({
        result: {
          texts: body.params.texts.map((item: { text: string }) => ({
            text: item.text === 'Night gathers' ? '夜幕降临' : '守望开始'
          }))
        }
      }), { status: 200 });
    });
    const provider = new DeepLFreeProvider({ fetch: fetchMock, requestDelayMs: 0 });

    const results = await provider.translate({
      sourceLanguage: 'en',
      targetLanguage: 'zh-CN',
      texts: [
        { id: 'p1', text: 'Night gathers' },
        { id: 'p2', text: 'My watch begins' }
      ]
    });

    expect(results).toEqual([
      { id: 'p1', translatedText: '夜幕降临' },
      { id: 'p2', translatedText: '守望开始' }
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('classifies 429 responses as rate limit errors', async () => {
    const fetchMock = vi.fn(async () => new Response('too many requests', { status: 429 }));
    const provider = new DeepLFreeProvider({ fetch: fetchMock, retryDelayMs: 0 });

    await expect(provider.translate({
      sourceLanguage: 'en',
      targetLanguage: 'zh-CN',
      texts: [{ id: 'p1', text: 'Night gathers' }]
    })).rejects.toMatchObject({
      code: 'RATE_LIMIT'
    } satisfies Partial<TranslationProviderError>);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('retries per-text requests after a rate limit response', async () => {
    const fetchMock = vi.fn(async () => {
      if (fetchMock.mock.calls.length === 1) {
        return new Response('too many requests', { status: 429 });
      }

      return new Response(JSON.stringify({
        result: {
          texts: [{ text: '夜幕降临' }]
        }
      }), { status: 200 });
    });
    const provider = new DeepLFreeProvider({ fetch: fetchMock, retryDelayMs: 0 });

    const results = await provider.translate({
      sourceLanguage: 'en',
      targetLanguage: 'zh-CN',
      texts: [{ id: 'p1', text: 'Night gathers' }]
    });

    expect(results).toEqual([{ id: 'p1', translatedText: '夜幕降临' }]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('splits a rate-limited batch and continues with smaller batches', async () => {
    const fetchMock = vi.fn(async (input: string | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body).replace('"method" : "', '"method":"').replace('"method": "', '"method":"'));
      if (body.params.texts.length > 1) {
        return new Response('too many requests', { status: 429 });
      }

      return new Response(JSON.stringify({
        result: {
          texts: [{ text: body.params.texts[0].text === 'Night gathers' ? '夜幕降临' : '守望开始' }]
        }
      }), { status: 200 });
    });
    const provider = new DeepLFreeProvider({
      fetch: fetchMock,
      requestDelayMs: 0,
      retryDelayMs: 0,
      maxBatchTexts: 2
    });

    const results = await provider.translate({
      sourceLanguage: 'en',
      targetLanguage: 'zh-CN',
      texts: [
        { id: 'p1', text: 'Night gathers' },
        { id: 'p2', text: 'My watch begins' }
      ]
    });

    expect(results).toEqual([
      { id: 'p1', translatedText: '夜幕降临' },
      { id: 'p2', translatedText: '守望开始' }
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('rejects malformed translated text responses', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      result: {
        texts: [{}]
      }
    }), { status: 200 }));
    const provider = new DeepLFreeProvider({ fetch: fetchMock });

    await expect(provider.translate({
      sourceLanguage: 'en',
      targetLanguage: 'zh-CN',
      texts: [{ id: 'p1', text: 'Night gathers' }]
    })).rejects.toMatchObject({
      code: 'PARSE'
    } satisfies Partial<TranslationProviderError>);
  });
});
