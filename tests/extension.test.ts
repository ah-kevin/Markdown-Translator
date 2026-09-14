import { describe, expect, it } from 'vitest';
import { isMarkdownLanguage, isOpenableMarkdownResource } from '../src/preview/resource';

describe('isMarkdownLanguage', () => {
  it('accepts plain markdown documents', () => {
    expect(isMarkdownLanguage('markdown')).toBe(true);
  });

  it.each(['prompt', 'instructions', 'chatagent', 'skill'])(
    'accepts VSCode built-in markdown-based language %s (e.g. SKILL.md)',
    (languageId) => {
      expect(isMarkdownLanguage(languageId)).toBe(true);
    }
  );

  it('rejects non-markdown languages', () => {
    expect(isMarkdownLanguage('plaintext')).toBe(false);
  });
});

describe('isOpenableMarkdownResource', () => {
  it('rejects VSCode webview panel pseudo resources', () => {
    const resource = { scheme: 'webview-panel', path: 'webview-panel/webview-markdown.preview-abc' };

    expect(isOpenableMarkdownResource(resource)).toBe(false);
  });

  it('accepts markdown document resources', () => {
    const resource = { scheme: 'file', path: '/tmp/example.md' };

    expect(isOpenableMarkdownResource(resource)).toBe(true);
  });
});
