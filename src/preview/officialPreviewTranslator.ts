import MarkdownIt from 'markdown-it';
import type Token from 'markdown-it/lib/token.mjs';
import { BlockTranslationResult } from '../translation/types';

type ResourceLike = string | { toString(): string };

const maxTranslationResources = 50;
const translationsByResource = new Map<string, BlockTranslationResult[]>();

export function setOfficialPreviewTranslations(
  resource: ResourceLike,
  translations: BlockTranslationResult[]
): void {
  const key = resourceKey(resource);
  translationsByResource.delete(key);
  translationsByResource.set(key, translations);
  pruneTranslationResources();
}

export function clearOfficialPreviewTranslations(resource: ResourceLike): void {
  translationsByResource.delete(resourceKey(resource));
}

export function getOfficialPreviewTranslationResourceCount(): number {
  return translationsByResource.size;
}

export function extendMarkdownItWithTranslations(markdown: MarkdownIt): MarkdownIt {
  const originalRender = markdown.renderer.render.bind(markdown.renderer);
  const defaultRenderToken = markdown.renderer.renderToken.bind(markdown.renderer);
  const originalBlockquoteOpen = markdown.renderer.rules.blockquote_open;
  const originalBlockquoteClose = markdown.renderer.rules.blockquote_close;
  const originalListItemOpen = markdown.renderer.rules.list_item_open;
  const originalListItemClose = markdown.renderer.rules.list_item_close;
  const originalTableOpen = markdown.renderer.rules.table_open;
  const originalTableClose = markdown.renderer.rules.table_close;
  const originalHeadingOpen = markdown.renderer.rules.heading_open;
  const originalHeadingClose = markdown.renderer.rules.heading_close;
  const originalParagraphOpen = markdown.renderer.rules.paragraph_open;
  const originalParagraphClose = markdown.renderer.rules.paragraph_close;

  let blockIndex = 0;
  let blockquoteDepth = 0;
  let listItemDepth = 0;
  let tableDepth = 0;
  const pendingTranslations: Array<string | undefined> = [];

  markdown.renderer.render = (tokens, options, env) => {
    blockIndex = 0;
    blockquoteDepth = 0;
    listItemDepth = 0;
    tableDepth = 0;
    pendingTranslations.length = 0;
    return originalRender(tokens, options, env);
  };

  markdown.renderer.rules.blockquote_open = (tokens, index, options, env, self) => {
    blockquoteDepth += 1;
    return originalBlockquoteOpen
      ? originalBlockquoteOpen(tokens, index, options, env, self)
      : defaultRenderToken(tokens, index, options);
  };
  markdown.renderer.rules.blockquote_close = (tokens, index, options, env, self) => {
    blockquoteDepth -= 1;
    return originalBlockquoteClose
      ? originalBlockquoteClose(tokens, index, options, env, self)
      : defaultRenderToken(tokens, index, options);
  };
  markdown.renderer.rules.list_item_open = (tokens, index, options, env, self) => {
    listItemDepth += 1;
    return originalListItemOpen
      ? originalListItemOpen(tokens, index, options, env, self)
      : defaultRenderToken(tokens, index, options);
  };
  markdown.renderer.rules.list_item_close = (tokens, index, options, env, self) => {
    listItemDepth -= 1;
    return originalListItemClose
      ? originalListItemClose(tokens, index, options, env, self)
      : defaultRenderToken(tokens, index, options);
  };
  markdown.renderer.rules.table_open = (tokens, index, options, env, self) => {
    tableDepth += 1;
    return originalTableOpen
      ? originalTableOpen(tokens, index, options, env, self)
      : defaultRenderToken(tokens, index, options);
  };
  markdown.renderer.rules.table_close = (tokens, index, options, env, self) => {
    tableDepth -= 1;
    return originalTableClose
      ? originalTableClose(tokens, index, options, env, self)
      : defaultRenderToken(tokens, index, options);
  };

  markdown.renderer.rules.heading_open = (tokens, index, options, env, self) => {
    const block = resolveTranslation(tokens, index, env, blockIndex, blockquoteDepth, listItemDepth, tableDepth);
    pendingTranslations.push(block.translatedText);
    if (block.isTranslatable) {
      blockIndex += 1;
    }

    return originalHeadingOpen
      ? originalHeadingOpen(tokens, index, options, env, self)
      : defaultRenderToken(tokens, index, options);
  };
  markdown.renderer.rules.heading_close = (tokens, index, options, env, self) => {
    const rendered = originalHeadingClose
      ? originalHeadingClose(tokens, index, options, env, self)
      : defaultRenderToken(tokens, index, options);
    return rendered + renderTranslation(pendingTranslations.pop());
  };
  markdown.renderer.rules.paragraph_open = (tokens, index, options, env, self) => {
    const block = resolveTranslation(tokens, index, env, blockIndex, blockquoteDepth, listItemDepth, tableDepth);
    pendingTranslations.push(block.translatedText);
    if (block.isTranslatable) {
      blockIndex += 1;
    }

    return originalParagraphOpen
      ? originalParagraphOpen(tokens, index, options, env, self)
      : defaultRenderToken(tokens, index, options);
  };
  markdown.renderer.rules.paragraph_close = (tokens, index, options, env, self) => {
    const rendered = originalParagraphClose
      ? originalParagraphClose(tokens, index, options, env, self)
      : defaultRenderToken(tokens, index, options);
    return rendered + renderTranslation(pendingTranslations.pop());
  };

  return markdown;
}

function resolveTranslation(
  tokens: Token[],
  index: number,
  env: Record<string, unknown>,
  blockIndex: number,
  blockquoteDepth: number,
  listItemDepth: number,
  tableDepth: number
): { isTranslatable: boolean; translatedText?: string } {
  if (tableDepth > 0) {
    return { isTranslatable: false };
  }

  const resource = getEnvResource(env);
  const translations = resource ? translationsByResource.get(resource) : undefined;
  const inlineToken = tokens[index + 1];
  const text = inlineToken?.content?.trim();

  if (
    !inlineToken
    || inlineToken.type !== 'inline'
    || !text
    || isOnlyProtectedInline(inlineToken)
    || looksLikeFormulaBlock(text)
  ) {
    return { isTranslatable: false };
  }

  const expected = translations?.[blockIndex];
  return {
    isTranslatable: true,
    translatedText: expected?.id === `block-${blockIndex}` ? expected.translatedText : undefined
  };
}

function getEnvResource(env: Record<string, unknown>): string | undefined {
  const currentDocument = env.currentDocument;
  if (typeof currentDocument === 'string') {
    return currentDocument;
  }
  return currentDocument && typeof currentDocument === 'object' && 'toString' in currentDocument
    ? currentDocument.toString()
    : undefined;
}

function renderTranslation(translatedText: string | undefined): string {
  if (!translatedText) {
    return '';
  }

  return `<div class="md-translator-translation">${escapeHtml(translatedText)}</div>`;
}

function isOnlyProtectedInline(token: Token): boolean {
  const children = token.children ?? [];
  return children.length > 0 && children.every((child) => (
    child.type === 'code_inline'
    || child.type === 'html_inline'
    || (child.type === 'text' && !child.content?.trim())
  ));
}

function looksLikeFormulaBlock(text: string): boolean {
  return text.startsWith('$$') || text.endsWith('$$') || /\$[^$\n]+\$/.test(text);
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function resourceKey(resource: ResourceLike): string {
  return typeof resource === 'string' ? resource : resource.toString();
}

function pruneTranslationResources(): void {
  while (translationsByResource.size > maxTranslationResources) {
    const oldestKey = translationsByResource.keys().next().value;
    if (!oldestKey) {
      return;
    }
    translationsByResource.delete(oldestKey);
  }
}
