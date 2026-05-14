import { describe, expect, it } from 'vitest';
import { isOpenableMarkdownResource } from '../src/preview/resource';

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
