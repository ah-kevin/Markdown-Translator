import {
  BlockTranslationResult,
  TranslateBlocksOptions,
  TranslateBlocksProgress,
  TranslateText,
  TranslateResult
} from './types';

export async function translateBlocks(options: TranslateBlocksOptions): Promise<BlockTranslationResult[]> {
  const deduped = dedupeBlocks(options.blocks);

  const uniqueResults = await options.provider.translate({
    abortSignal: options.abortSignal,
    sourceLanguage: options.sourceLanguage,
    targetLanguage: options.targetLanguage,
    texts: deduped.requestTexts
  });

  return expandDedupeResults(uniqueResults, deduped);
}

export function mergeBlockTranslations(
  blocks: TranslateBlocksOptions['blocks'],
  existingTranslations: BlockTranslationResult[],
  newTranslations: BlockTranslationResult[]
): BlockTranslationResult[] {
  const byId = new Map<string, BlockTranslationResult>();
  for (const translation of existingTranslations) {
    if (translation.translatedText) {
      byId.set(translation.id, translation);
    }
  }
  for (const translation of newTranslations) {
    if (translation.translatedText) {
      byId.set(translation.id, translation);
    }
  }

  return blocks.map((block) => {
    const translation = byId.get(block.id);
    return {
      id: block.id,
      sourceText: block.text,
      translatedText: translation?.translatedText ?? ''
    };
  });
}

export function getUntranslatedBlocks(
  blocks: TranslateBlocksOptions['blocks'],
  existingTranslations: BlockTranslationResult[]
): TranslateBlocksOptions['blocks'] {
  const existingById = new Map(
    existingTranslations
      .filter((translation) => translation.translatedText)
      .map((translation) => [translation.id, translation])
  );

  return blocks.filter((block) => {
    const existing = existingById.get(block.id);
    return !existing || (existing.sourceText !== undefined && existing.sourceText !== block.text);
  });
}

export function createProgressReporter(
  blocks: TranslateBlocksOptions['blocks'],
  onProgress: (progress: TranslateBlocksProgress) => Promise<void> | void
): {
  requestTexts: TranslateText[];
  handleProviderProgress(results: TranslateResult[], completed: number, total: number): Promise<void>;
} {
  const deduped = dedupeBlocks(blocks);
  const uniqueResults = new Map<string, TranslateResult>();

  return {
    requestTexts: deduped.requestTexts,
    async handleProviderProgress(results, completed, total) {
      for (const result of results) {
        uniqueResults.set(result.id, result);
      }

      await onProgress({
        completed,
        total,
        translations: expandDedupeResults(Array.from(uniqueResults.values()), deduped)
      });
    }
  };
}

function dedupeBlocks(blocks: TranslateBlocksOptions['blocks']): {
  blocks: TranslateBlocksOptions['blocks'];
  requestTexts: TranslateText[];
  dedupeIdByBlockId: Map<string, string>;
} {
  const dedupeIdByText = new Map<string, string>();
  const textByDedupeId = new Map<string, string>();
  const dedupeIdByBlockId = new Map<string, string>();

  for (const block of blocks) {
    if (!dedupeIdByText.has(block.text)) {
      const dedupeId = `dedupe-${dedupeIdByText.size}`;
      dedupeIdByText.set(block.text, dedupeId);
      textByDedupeId.set(dedupeId, block.text);
    }

    const dedupeId = dedupeIdByText.get(block.text);
    if (dedupeId) {
      dedupeIdByBlockId.set(block.id, dedupeId);
    }
  }

  return {
    blocks,
    requestTexts: Array.from(textByDedupeId.entries()).map(([id, text]) => ({ id, text })),
    dedupeIdByBlockId
  };
}

function expandDedupeResults(
  uniqueResults: TranslateResult[],
  deduped: ReturnType<typeof dedupeBlocks>
): BlockTranslationResult[] {
  const translationByDedupeId = new Map<string, TranslateResult>(
    uniqueResults.map((result) => [result.id, result])
  );

  return deduped.blocks.map((block) => {
    const dedupeId = deduped.dedupeIdByBlockId.get(block.id);
    const translation = dedupeId ? translationByDedupeId.get(dedupeId) : undefined;
    return {
      id: block.id,
      sourceText: block.text,
      translatedText: restoreProtectedInlines(translation?.translatedText ?? '', block.protectedInlines)
    };
  });
}

function restoreProtectedInlines(
  translatedText: string,
  protectedInlines: TranslateBlocksOptions['blocks'][number]['protectedInlines']
): string {
  let restored = translatedText;
  for (const protectedInline of protectedInlines ?? []) {
    restored = restored.split(protectedInline.placeholder).join(protectedInline.value);
  }
  return restored;
}
