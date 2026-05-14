import { DeepLFreeProvider } from './deeplFreeProvider';
import { GoogleWebProvider, TranslationProviderError } from './googleWebProvider';
import {
  TranslateResult,
  TranslationProvider,
  TranslationProviderId,
  TranslationProviderMetadata
} from './types';

export const translationProviders: TranslationProviderMetadata[] = [
  { id: 'googleWeb', label: 'Google Web' },
  { id: 'deeplFree', label: 'DeepL Free' }
];

type ProviderFactoryOptions = {
  providerId: string;
  log?: (message: string) => void;
  onBatchComplete?: (results: TranslateResult[], completed: number, total: number) => Promise<void> | void;
};

export function normalizeProviderId(providerId: string | undefined): TranslationProviderId {
  return providerId === 'deeplFree' ? 'deeplFree' : 'googleWeb';
}

export function getProviderLabel(providerId: TranslationProviderId): string {
  return translationProviders.find((provider) => provider.id === providerId)?.label ?? 'Google Web';
}

export function createTranslationProvider(options: ProviderFactoryOptions): TranslationProvider {
  const providerId = normalizeProviderId(options.providerId);

  if (providerId === 'deeplFree') {
    return new DeepLFreeProvider({
      log: options.log,
      onBatchComplete: options.onBatchComplete
    });
  }

  return new GoogleWebProvider({
    candidate: 'mobile',
    log: options.log,
    onBatchComplete: options.onBatchComplete
  });
}

export function describeProviderError(error: unknown, providerLabel: string): string {
  if (error instanceof TranslationProviderError) {
    if (error.code === 'RATE_LIMIT') {
      return `${providerLabel} 请求过快或被限流，请稍后再试。`;
    }
    if (error.code === 'NETWORK') {
      return `${providerLabel} 请求失败，请检查网络连接。`;
    }
    if (error.code === 'PARSE') {
      return `${providerLabel} 返回结构无法解析，可能是页面结构变化。`;
    }
    return `${providerLabel} 返回 HTTP ${error.status ?? '错误'}。`;
  }

  return error instanceof Error ? error.message : '翻译失败';
}
