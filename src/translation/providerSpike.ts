import {
  FetchLike,
  GoogleWebProvider,
  TranslationCandidate,
  TranslationProviderError,
  TranslationProviderErrorCode
} from './googleWebProvider';

export type ProviderSpikeOptions = {
  fetch?: FetchLike;
  sourceLanguage: string;
  targetLanguage: string;
  text: string;
};

export type ProviderSpikeResult =
  | {
      candidate: TranslationCandidate;
      ok: true;
      translatedText: string;
    }
  | {
      candidate: TranslationCandidate;
      ok: false;
      errorCode: TranslationProviderErrorCode;
      message: string;
    };

const candidates: TranslationCandidate[] = ['mobile', 'rpc'];

export async function runProviderSpike(options: ProviderSpikeOptions): Promise<ProviderSpikeResult[]> {
  const results: ProviderSpikeResult[] = [];

  for (const candidate of candidates) {
    const provider = new GoogleWebProvider({
      fetch: options.fetch,
      candidate
    });

    try {
      const [result] = await provider.translate({
        sourceLanguage: options.sourceLanguage,
        targetLanguage: options.targetLanguage,
        texts: [{ id: 'spike', text: options.text }]
      });

      results.push({
        candidate,
        ok: true,
        translatedText: result.translatedText
      });
    } catch (error) {
      if (error instanceof TranslationProviderError) {
        results.push({
          candidate,
          ok: false,
          errorCode: error.code,
          message: error.message
        });
      } else {
        results.push({
          candidate,
          ok: false,
          errorCode: 'NETWORK',
          message: error instanceof Error ? error.message : 'Unknown provider spike error.'
        });
      }
    }
  }

  return results;
}
