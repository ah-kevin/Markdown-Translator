import { describe, expect, it, vi } from 'vitest';
import { runProviderSpike } from '../src/translation/providerSpike';

describe('runProviderSpike', () => {
  it('returns one result per Google Web candidate', async () => {
    const fetchMock = vi.fn(async (input: string | URL) => {
      const url = input.toString();
      if (url.includes('/m?')) {
        return new Response('<div class="result-container">长夜将至</div>', { status: 200 });
      }

      const inner = JSON.stringify([[['长夜将至', 'Night gathers', null, null, 3]], null, 'en']);
      const outer = JSON.stringify([['wrb.fr', 'MkEWBc', inner, null, null, null, 'generic']]);
      return new Response(`)]}'\n\n${outer}\n`, { status: 200 });
    });

    const results = await runProviderSpike({
      fetch: fetchMock,
      sourceLanguage: 'en',
      targetLanguage: 'zh-CN',
      text: 'Night gathers'
    });

    expect(results).toEqual([
      { candidate: 'mobile', ok: true, translatedText: '长夜将至' },
      { candidate: 'rpc', ok: true, translatedText: '长夜将至' }
    ]);
  });

  it('keeps candidate failures structured instead of throwing', async () => {
    const fetchMock = vi.fn(async (input: string | URL) => {
      const url = input.toString();
      if (url.includes('/m?')) {
        return new Response('too many requests', { status: 429 });
      }
      return new Response('not rpc json', { status: 200 });
    });

    const results = await runProviderSpike({
      fetch: fetchMock,
      sourceLanguage: 'en',
      targetLanguage: 'zh-CN',
      text: 'Night gathers'
    });

    expect(results).toEqual([
      { candidate: 'mobile', ok: false, errorCode: 'RATE_LIMIT', message: 'Google Web translation is rate limited.' },
      { candidate: 'rpc', ok: false, errorCode: 'PARSE', message: 'Failed to parse Google RPC translation response.' }
    ]);
  });
});
