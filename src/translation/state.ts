export type TranslationState = 'running' | 'translated' | 'failed';

export type TranslationAction = 'start' | 'noop';

export function getTranslateAction(state: TranslationState | undefined): TranslationAction {
  if (state === 'running' || state === 'translated') {
    return 'noop';
  }

  return 'start';
}
