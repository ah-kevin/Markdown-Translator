# Markdown Translator

[English](./README.md) | [中文](./README.zh-CN.md)

VSCode Desktop extension for reading Markdown with bilingual translation.

## MVP Behavior

- Enhances VSCode's built-in Markdown Preview without modifying the source `.md` file.
- Adds a translate button to the official Markdown Preview editor title bar.
- Inserts translated text below each source block using a quote-style display.
- Uses Google Web translation without an API key.
- Supports source/target language settings.

## Technical Route

The project uses VSCode's official Markdown Preview as the rendering surface.

1. The user opens the built-in Markdown Preview.
2. `Markdown Translator: Translate Preview` is contributed to the preview editor title bar.
3. The command resolves the source Markdown document, including the `webview-panel:` case from preview title buttons.
4. The extension host collects translatable Markdown blocks with `markdown-it`.
5. The Google Web provider translates those blocks through the mobile `/m` endpoint, batching multiple blocks into one request when possible.
6. Results are cached in memory by document URI for the current session.
7. A `markdown.markdownItPlugins` contribution injects translated DOM during official Markdown rendering.
8. Each completed batch updates the in-memory translation store and calls `markdown.api.reloadPlugins`, so long documents can progressively render translated blocks.

This keeps the source document untouched while avoiding a custom preview webview.

## Interaction Rules

- If a document has no translations, the translate button starts translation.
- If a document is currently translating, clicking translate is a no-op.
- If a document is already translated, clicking translate is a no-op.
- If translation failed, clicking translate retries.
- If translations are cleared, clicking translate starts a new translation.

## Commands

- `Markdown Translator: Translate Preview`
  - Translates the current Markdown document and refreshes the official Markdown Preview.
- `Markdown Translator: Clear Preview Translations`
  - Clears in-memory translations for the current Markdown Preview and refreshes the official preview.
- `Markdown Translator: Run Provider Spike`
  - Tests Google Web `mobile` and `rpc` candidates against selected text or a default sample.

## Settings

- `markdownTranslator.sourceLanguage`
  - Default: `auto`
- `markdownTranslator.targetLanguage`
  - Default: `zh-CN`

## Development

```bash
npm install
npm test
npm run typecheck
npm run compile
npm run host
```

`npm run host` compiles the extension and opens a VSCode Extension Development Host window with `/tmp/markdown-translator-smoke` as the test workspace.

## Local VSIX Install

Build a local VSIX package:

```bash
npm run package
```

Install it into VSCode:

```bash
code --install-extension markdown-translator-0.0.1.vsix
```

Or install from the VSCode UI:

1. Open Extensions.
2. Open the `...` menu.
3. Choose `Install from VSIX...`.
4. Select `markdown-translator-0.0.1.vsix`.

After installing, open a Markdown file, run `Markdown: Open Preview to the Side`, and use the Markdown Translator buttons in the preview title bar.

## Notes

Current scope:

- Translate headings, paragraphs, list items, and blockquotes.
- Skip fenced code blocks, inline code, formulas, YAML front matter, HTML blocks, and tables.
- Batch multiple Google Web mobile translations with stable markers, progressively render completed batches, and fall back to per-block requests if a batch result cannot be split safely.
- Protect inline code with placeholders during translation and restore it after translation.
- Prevent concurrent translation runs for the same document.
- Keep translation state bounded in memory and clear it when Markdown documents change or close.
- Keep only current-session in-memory translation state.
- Keep Google Web domain and retry behavior internal for now.

Next route:

1. Install the local VSIX in daily VSCode and validate it against real Markdown documents.
2. Tune long-document batch sizing and rate-limit handling around Google Web `/m` limits with real documents.
