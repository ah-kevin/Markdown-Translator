import { describe, expect, it, vi } from 'vitest';
import {
  DeepLFreeProvider,
  createDeepLRequestBody,
  parseDeepLFreeTranslation
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
    expect(payload.params.texts).toEqual([
      { text: 'Night gathers', requestAlternatives: 0 }
    ]);
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
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      result: {
        texts: [
          { text: '夜幕降临' },
          { text: '守望开始' }
        ]
      }
    }), { status: 200 }));
    const provider = new DeepLFreeProvider({ fetch: fetchMock });

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
    const provider = new DeepLFreeProvider({ fetch: fetchMock });

    await expect(provider.translate({
      sourceLanguage: 'en',
      targetLanguage: 'zh-CN',
      texts: [{ id: 'p1', text: 'Night gathers' }]
    })).rejects.toMatchObject({
      code: 'RATE_LIMIT'
    } satisfies Partial<TranslationProviderError>);
  });

  it('rejects responses whose translated text count does not match', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      result: {
        texts: [{ text: '夜幕降临' }]
      }
    }), { status: 200 }));
    const provider = new DeepLFreeProvider({ fetch: fetchMock });

    await expect(provider.translate({
      sourceLanguage: 'en',
      targetLanguage: 'zh-CN',
      texts: [
        { id: 'p1', text: 'Night gathers' },
        { id: 'p2', text: 'My watch begins' }
      ]
    })).rejects.toMatchObject({
      code: 'PARSE'
    } satisfies Partial<TranslationProviderError>);
  });
});
