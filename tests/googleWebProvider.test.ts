import { describe, expect, it, vi } from 'vitest';
import {
  GoogleWebProvider,
  TranslationProviderError,
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
