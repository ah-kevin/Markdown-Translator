import MarkdownIt from 'markdown-it';
import { describe, expect, it } from 'vitest';
import {
  clearOfficialPreviewTranslations,
  extendMarkdownItWithTranslations,
  getOfficialPreviewTranslations,
  setOfficialPreviewTranslations
} from '../src/preview/officialPreviewTranslator';

describe('official preview translation injection', () => {
  it('injects cached translations into the official markdown-it render output', () => {
    const markdown = extendMarkdownItWithTranslations(new MarkdownIt({ html: true }));
    const resource = 'file:///tmp/night.md';

    setOfficialPreviewTranslations(resource, [
      { id: 'block-0', translatedText: '守夜人' },
      { id: 'block-1', translatedText: '夜幕降临，我的守夜开始了。' },
      { id: 'block-2', translatedText: '我将不娶妻。' },
      { id: 'block-3', translatedText: '改进围绕 Google Web `/m` 限制的长文档批处理。' }
    ]);

    const html = markdown.render(`# Night Watch

Night gathers, and now my watch begins.

- I shall take no wife.
- Improve long-document batching around Google Web \`/m\` limits.

\`\`\`ts
const ignored = true;
\`\`\`
`, { currentDocument: resource });

    expect(html).toContain('<div class="md-translator-translation">守夜人</div>');
    expect(html).toContain('<div class="md-translator-translation">夜幕降临，我的守夜开始了。</div>');
    expect(html).toContain('<div class="md-translator-translation">我将不娶妻。</div>');
    expect(html).toContain('<div class="md-translator-translation">改进围绕 Google Web `/m` 限制的长文档批处理。</div>');
    expect(html).not.toContain('const ignored = true;</code></pre><div class="md-translator-translation">');

    clearOfficialPreviewTranslations(resource);
  });

  it('resets block matching between render calls', () => {
    const markdown = extendMarkdownItWithTranslations(new MarkdownIt());
    const resource = 'file:///tmp/reset.md';

    setOfficialPreviewTranslations(resource, [
      { id: 'block-0', translatedText: '第一段' }
    ]);
    expect(getOfficialPreviewTranslations(resource)).toEqual([
      { id: 'block-0', translatedText: '第一段' }
    ]);

    const first = markdown.render('First paragraph.', { currentDocument: resource });
    const second = markdown.render('First paragraph.', { currentDocument: resource });

    expect(first).toContain('<div class="md-translator-translation">第一段</div>');
    expect(second).toContain('<div class="md-translator-translation">第一段</div>');

    clearOfficialPreviewTranslations(resource);
  });

  it('keeps block matching aligned when inline code contains shell variables', () => {
    const markdown = extendMarkdownItWithTranslations(new MarkdownIt({ html: true }));
    const resource = 'file:///tmp/shell-vars.md';

    setOfficialPreviewTranslations(resource, [
      { id: 'block-0', translatedText: '第一个段落' },
      {
        id: 'block-1',
        translatedText: '`surface_locator` 会保留 provider locator，例如 `wXtYpZ:UUID` 形式的 `$ITERM_SESSION_ID`。'
      },
      { id: 'block-2', translatedText: '后续段落' }
    ]);

    const html = markdown.render(`First paragraph.

- \`surface_locator\` preserves the provider locator, such as \`$ITERM_SESSION_ID\` in \`wXtYpZ:UUID\` form or Codex App \`$CODEX_THREAD_ID\`. Do not reduce it to UUID only when registering.

Following paragraph.
`, { currentDocument: resource });

    expect(html).toContain('<div class="md-translator-translation">第一个段落</div>');
    expect(html).toContain('<div class="md-translator-translation">`surface_locator` 会保留 provider locator，例如 `wXtYpZ:UUID` 形式的 `$ITERM_SESSION_ID`。</div>');
    expect(html).toContain('<div class="md-translator-translation">后续段落</div>');

    clearOfficialPreviewTranslations(resource);
  });
});
