import { describe, expect, it } from 'vitest';
import {
  clearOfficialPreviewTranslations,
  getOfficialPreviewTranslationResourceCount,
  setOfficialPreviewTranslations
} from '../src/preview/officialPreviewTranslator';

describe('official preview translation store', () => {
  it('clears translations for a document resource', () => {
    const resource = 'file:///tmp/clear.md';

    setOfficialPreviewTranslations(resource, [{ id: 'block-0', translatedText: '译文' }]);
    expect(getOfficialPreviewTranslationResourceCount()).toBeGreaterThan(0);

    clearOfficialPreviewTranslations(resource);
    expect(getOfficialPreviewTranslationResourceCount()).toBe(0);
  });

  it('keeps a bounded number of document translation entries', () => {
    for (let index = 0; index < 55; index += 1) {
      setOfficialPreviewTranslations(`file:///tmp/${index}.md`, [
        { id: 'block-0', translatedText: String(index) }
      ]);
    }

    expect(getOfficialPreviewTranslationResourceCount()).toBeLessThanOrEqual(50);

    for (let index = 0; index < 55; index += 1) {
      clearOfficialPreviewTranslations(`file:///tmp/${index}.md`);
    }
  });
});
