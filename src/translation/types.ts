import { TranslatableBlock } from '../markdown/blockCollector';

export type TranslateText = {
  id: string;
  text: string;
};

export type TranslateRequest = {
  sourceLanguage: string;
  targetLanguage: string;
  texts: TranslateText[];
};

export type TranslateResult = {
  id: string;
  translatedText: string;
};

export interface TranslationProvider {
  translate(request: TranslateRequest): Promise<TranslateResult[]>;
}

export type TranslationProviderId = 'googleWeb' | 'deeplFree';

export type TranslationProviderMetadata = {
  id: TranslationProviderId;
  label: string;
};

export type TranslateBlocksOptions = {
  provider: TranslationProvider;
  sourceLanguage: string;
  targetLanguage: string;
  blocks: TranslatableBlock[];
};

export type TranslateBlocksProgress = {
  completed: number;
  total: number;
  translations: BlockTranslationResult[];
};

export type BlockTranslationResult = {
  id: string;
  translatedText: string;
};
