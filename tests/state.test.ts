import { describe, expect, it } from 'vitest';
import { getTranslateAction } from '../src/translation/state';

describe('getTranslateAction', () => {
  it('does nothing when a document is running or already translated', () => {
    expect(getTranslateAction('running')).toBe('noop');
    expect(getTranslateAction('translated')).toBe('noop');
  });

  it('starts translation when a document is idle or failed', () => {
    expect(getTranslateAction(undefined)).toBe('start');
    expect(getTranslateAction('failed')).toBe('start');
  });
});
