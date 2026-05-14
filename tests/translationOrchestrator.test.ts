import { describe, expect, it, vi } from 'vitest';
import { createProgressReporter, translateBlocks } from '../src/translation/translationOrchestrator';
import { TranslationProvider } from '../src/translation/types';

describe('translateBlocks', () => {
  it('deduplicates identical block text within a single translation run', async () => {
    const provider: TranslationProvider = {
      translate: vi.fn(async (request) => request.texts.map((item) => ({
        id: item.id,
        translatedText: item.text === 'Night gathers' ? '长夜将至' : '守望开始'
      })))
    };

    const results = await translateBlocks({
      provider,
      sourceLanguage: 'en',
      targetLanguage: 'zh-CN',
      blocks: [
        { id: 'block-0', kind: 'paragraph', text: 'Night gathers' },
        { id: 'block-1', kind: 'paragraph', text: 'Night gathers' },
        { id: 'block-2', kind: 'paragraph', text: 'My watch begins' }
      ]
    });

    expect(provider.translate).toHaveBeenCalledWith({
      sourceLanguage: 'en',
      targetLanguage: 'zh-CN',
      texts: [
        { id: 'dedupe-0', text: 'Night gathers' },
        { id: 'dedupe-1', text: 'My watch begins' }
      ]
    });
    expect(results).toEqual([
      { id: 'block-0', translatedText: '长夜将至' },
      { id: 'block-1', translatedText: '长夜将至' },
      { id: 'block-2', translatedText: '守望开始' }
    ]);
  });

  it('maps provider batch progress back to original block ids', async () => {
    const onProgress = vi.fn();
    const reporter = createProgressReporter([
      { id: 'block-0', kind: 'paragraph', text: 'Night gathers' },
      { id: 'block-1', kind: 'paragraph', text: 'Night gathers' },
      { id: 'block-2', kind: 'paragraph', text: 'My watch begins' }
    ], onProgress);

    expect(reporter.requestTexts).toEqual([
      { id: 'dedupe-0', text: 'Night gathers' },
      { id: 'dedupe-1', text: 'My watch begins' }
    ]);

    await reporter.handleProviderProgress([
      { id: 'dedupe-0', translatedText: '长夜将至' }
    ], 1, 2);

    expect(onProgress).toHaveBeenCalledWith({
      completed: 1,
      total: 2,
      translations: [
        { id: 'block-0', translatedText: '长夜将至' },
        { id: 'block-1', translatedText: '长夜将至' },
        { id: 'block-2', translatedText: '' }
      ]
    });
  });

  it('restores protected inline code placeholders after translation', async () => {
    const provider: TranslationProvider = {
      translate: vi.fn(async () => [{
        id: 'dedupe-0',
        translatedText: '改进围绕 Google Web __MD_TRANSLATOR_CODE_0__ 限制的长文档批处理。'
      }])
    };

    const results = await translateBlocks({
      provider,
      sourceLanguage: 'en',
      targetLanguage: 'zh-CN',
      blocks: [{
        id: 'block-0',
        kind: 'listItem',
        text: 'Improve long-document batching around Google Web __MD_TRANSLATOR_CODE_0__ limits.',
        protectedInlines: [{ placeholder: '__MD_TRANSLATOR_CODE_0__', value: '/m' }]
      }]
    });

    expect(provider.translate).toHaveBeenCalledWith({
      sourceLanguage: 'en',
      targetLanguage: 'zh-CN',
      texts: [{
        id: 'dedupe-0',
        text: 'Improve long-document batching around Google Web __MD_TRANSLATOR_CODE_0__ limits.'
      }]
    });
    expect(results).toEqual([{
      id: 'block-0',
      translatedText: '改进围绕 Google Web /m 限制的长文档批处理。'
    }]);
  });
});
