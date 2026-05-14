export type ResourceParts = {
  scheme: string;
  path: string;
};

export function isOpenableMarkdownResource(resource: ResourceParts): boolean {
  if (resource.scheme === 'webview-panel') {
    return false;
  }

  return /\.(md|markdown|mdown|mkd|mdwn|mdtxt|mdtext)$/i.test(resource.path);
}
