export type ResourceParts = {
  scheme: string;
  path: string;
};

// VSCode's built-in prompt-basics extension assigns these ids to markdown files
// such as SKILL.md and *.prompt.md; the official Markdown Preview accepts them too.
const markdownLanguageIds = new Set(['markdown', 'prompt', 'instructions', 'chatagent', 'skill']);

export function isMarkdownLanguage(languageId: string | undefined): boolean {
  return languageId !== undefined && markdownLanguageIds.has(languageId);
}

export function isOpenableMarkdownResource(resource: ResourceParts): boolean {
  if (resource.scheme === 'webview-panel') {
    return false;
  }

  return /\.(md|markdown|mdown|mkd|mdwn|mdtxt|mdtext)$/i.test(resource.path);
}
