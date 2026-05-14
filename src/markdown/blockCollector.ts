import MarkdownIt from 'markdown-it';

export type TranslatableBlockKind = 'heading' | 'paragraph' | 'listItem' | 'blockquote';

export type TranslatableBlock = {
  id: string;
  kind: TranslatableBlockKind;
  text: string;
  protectedInlines?: ProtectedInline[];
};

export type ProtectedInline = {
  placeholder: string;
  value: string;
};

const markdown = new MarkdownIt({
  html: true,
  linkify: false,
  typographer: false
});

export function collectTranslatableBlocks(source: string): TranslatableBlock[] {
  const tokens = markdown.parse(stripYamlFrontMatter(source), {});
  const blocks: TranslatableBlock[] = [];
  let blockquoteDepth = 0;
  let listItemDepth = 0;
  let tableDepth = 0;

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];

    if (token.type === 'blockquote_open') {
      blockquoteDepth += 1;
      continue;
    }
    if (token.type === 'blockquote_close') {
      blockquoteDepth -= 1;
      continue;
    }
    if (token.type === 'list_item_open') {
      listItemDepth += 1;
      continue;
    }
    if (token.type === 'list_item_close') {
      listItemDepth -= 1;
      continue;
    }
    if (token.type === 'table_open') {
      tableDepth += 1;
      continue;
    }
    if (token.type === 'table_close') {
      tableDepth -= 1;
      continue;
    }

    if (tableDepth > 0 || token.type === 'fence' || token.type === 'html_block') {
      continue;
    }

    if (token.type !== 'heading_open' && token.type !== 'paragraph_open') {
      continue;
    }

    const inlineToken = tokens[index + 1];
    if (!inlineToken || inlineToken.type !== 'inline') {
      continue;
    }

    const protectedText = protectInlineContent(inlineToken);
    const text = protectedText.text.trim();
    if (!text || isOnlyProtectedInline(inlineToken) || looksLikeFormulaBlock(text)) {
      continue;
    }

    const block: TranslatableBlock = {
      id: `block-${blocks.length}`,
      kind: getBlockKind(token.type, blockquoteDepth, listItemDepth),
      text
    };
    if (protectedText.protectedInlines.length > 0) {
      block.protectedInlines = protectedText.protectedInlines;
    }
    blocks.push(block);
  }

  return blocks;
}

function stripYamlFrontMatter(source: string): string {
  return source.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '');
}

function isOnlyProtectedInline(token: { children: Array<{ type: string; content?: string }> | null }): boolean {
  const children = token.children ?? [];
  return children.length > 0 && children.every((child) => (
    child.type === 'code_inline'
    || child.type === 'html_inline'
    || (child.type === 'text' && !child.content?.trim())
  ));
}

function looksLikeFormulaBlock(text: string): boolean {
  return text.startsWith('$$') || text.endsWith('$$') || /(^|[\s(\[{])\$[^$\n]*\S\$(?=$|[\s.,;:!?)\]}])/u.test(text);
}

function getBlockKind(
  tokenType: string,
  blockquoteDepth: number,
  listItemDepth: number
): TranslatableBlockKind {
  if (blockquoteDepth > 0) {
    return 'blockquote';
  }
  if (tokenType === 'heading_open') {
    return 'heading';
  }
  if (listItemDepth > 0) {
    return 'listItem';
  }
  return 'paragraph';
}

function protectInlineContent(token: { content: string; children: Array<{ type: string; content: string }> | null }): {
  text: string;
  protectedInlines: ProtectedInline[];
} {
  const protectedInlines: ProtectedInline[] = [];
  const children = token.children;
  if (!children) {
    return { text: token.content, protectedInlines };
  }

  const text = children.map((child) => {
    if (child.type !== 'code_inline') {
      return child.content;
    }

    const placeholder = `__MD_TRANSLATOR_CODE_${protectedInlines.length}__`;
    protectedInlines.push({ placeholder, value: child.content });
    return placeholder;
  }).join('');

  return { text, protectedInlines };
}
