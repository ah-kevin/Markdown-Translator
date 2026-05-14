import { describe, expect, it } from 'vitest';
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
});
