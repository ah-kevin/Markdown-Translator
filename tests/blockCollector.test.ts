import { describe, expect, it } from 'vitest';
import { collectTranslatableBlocks } from '../src/markdown/blockCollector';

describe('collectTranslatableBlocks', () => {
  it('collects reading blocks and skips protected Markdown regions', () => {
    const markdown = `---
title: Private Metadata
---

# Night Watch

Night gathers, and now my watch begins.

- I shall take no wife.
- \`const crown = false\`
- Improve long-document batching around Google Web \`/m\` limits.

> I shall live and die at my post.

\`\`\`ts
const ignored = true;
\`\`\`

Paragraph with \`inline code\` should still be translated.

$$
e = mc^2
$$

<section>HTML should be skipped.</section>

| Source | Target |
| --- | --- |
| A | B |
`;

    expect(collectTranslatableBlocks(markdown)).toEqual([
      { id: 'block-0', kind: 'heading', text: 'Night Watch' },
      { id: 'block-1', kind: 'paragraph', text: 'Night gathers, and now my watch begins.' },
      { id: 'block-2', kind: 'listItem', text: 'I shall take no wife.' },
      {
        id: 'block-3',
        kind: 'listItem',
        text: 'Improve long-document batching around Google Web __MD_TRANSLATOR_CODE_0__ limits.',
        protectedInlines: [{ placeholder: '__MD_TRANSLATOR_CODE_0__', value: '/m' }]
      },
      { id: 'block-4', kind: 'blockquote', text: 'I shall live and die at my post.' },
      {
        id: 'block-5',
        kind: 'paragraph',
        text: 'Paragraph with __MD_TRANSLATOR_CODE_0__ should still be translated.',
        protectedInlines: [{ placeholder: '__MD_TRANSLATOR_CODE_0__', value: 'inline code' }]
      }
    ]);
  });

  it('does not treat shell variables as inline formulas', () => {
    const markdown = '- surface_locator can use $ITERM_SESSION_ID or $CODEX_THREAD_ID when registering.';

    expect(collectTranslatableBlocks(markdown)).toEqual([{
      id: 'block-0',
      kind: 'listItem',
      text: 'surface_locator can use $ITERM_SESSION_ID or $CODEX_THREAD_ID when registering.'
    }]);
  });

  it('still skips inline math formulas', () => {
    const markdown = '- Keep $x + y$ unchanged.';

    expect(collectTranslatableBlocks(markdown)).toEqual([]);
  });
});
