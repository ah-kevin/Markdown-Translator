import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createTranslationProvider,
  getProviderLabel,
  normalizeProviderId,
  translationProviders
} from '../src/translation/providerFactory';

describe('provider factory metadata', () => {
  it('normalizes unknown provider ids to Google Web', () => {
    expect(normalizeProviderId(undefined)).toBe('googleWeb');
    expect(normalizeProviderId('unknown')).toBe('googleWeb');
    expect(normalizeProviderId('deeplFree')).toBe('deeplFree');
  });

  it('exposes labels for provider selection', () => {
    expect(translationProviders).toEqual([
      { id: 'googleWeb', label: 'Google Web' },
      { id: 'deeplFree', label: 'DeepL Free' }
    ]);
    expect(getProviderLabel('googleWeb')).toBe('Google Web');
    expect(getProviderLabel('deeplFree')).toBe('DeepL Free');
  });

  it('creates DeepL Free provider with tuning options', () => {
    const provider = createTranslationProvider({
      providerId: 'deeplFree',
      deeplFree: {
        maxBatchCharacters: 300,
        maxBatchTexts: 2,
        maxRetries: 1,
        requestDelayMs: 10,
        retryDelayMs: 20
      }
    });

    expect(provider).toBeTruthy();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('creates a Google Web provider that posts to translate_a/single with a Google cookie', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = input instanceof URL ? input : new URL(String(input));
      if (url.pathname === '/') {
        return new Response('', { status: 200, headers: { 'Set-Cookie': 'NID=abc123; path=/; domain=.google.com' } });
      }
      if (url.pathname === '/translate_a/single') {
        return new Response(JSON.stringify([[['长夜将至', 'Night gathers', null, null, 3]], null, 'en']), { status: 200 });
      }
      return new Response('not found', { status: 404 });
    });
    const provider = createTranslationProvider({ providerId: 'googleWeb' });

    const results = await provider.translate({
      sourceLanguage: 'en',
      targetLanguage: 'zh-CN',
      texts: [{ id: 'p1', text: 'Night gathers' }]
    });

    expect(results).toEqual([{ id: 'p1', translatedText: '长夜将至' }]);
    const paths = fetchSpy.mock.calls.map(([input]) => (input instanceof URL ? input : new URL(String(input))).pathname);
    expect(paths).toEqual(['/', '/translate_a/single']);
  });
});
